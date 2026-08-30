import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.AURAXIS_ALLOW_UNSAFE_CODE = '1';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const coreDist = path.join(root, 'packages', 'core', 'dist', 'index.js');
const cliDist = path.join(root, 'packages', 'cli', 'dist', 'main.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-matrix-'));

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✓ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
    console.error(`✗ ${name} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

let core;
try {
  core = await import(pathToFileURL(coreDist).href);
} catch {
  console.error('请先运行 npm run build');
  process.exit(1);
}

async function writeTree(dir, files) {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(dir, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
}

function sseChunk(response, delta, finishReason = null, usage) {
  const payload = {
    id: 'matrix-chunk',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'matrix-model',
    choices: [{
      index: 0,
      delta,
      ...(finishReason ? { finish_reason: finishReason } : {}),
    }],
    ...(usage ? { usage } : {}),
  };
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function runCliWithMock(workDir, steps, extraArgs = [], env = {}) {
  let calls = 0;
  const server = http.createServer((_request, response) => {
    calls += 1;
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const step = steps[calls - 1];
    if (step) {
      sseChunk(response, {
        tool_calls: [{
          index: 0,
          id: `call_${calls}`,
          type: 'function',
          function: { name: step.tool, arguments: JSON.stringify(step.args) },
        }],
      });
      sseChunk(response, {}, 'tool_calls');
    } else {
      sseChunk(response, { content: '<FINAL_ANSWER>matrix-done' });
      sseChunk(response, {}, 'stop', {
        prompt_tokens: 100,
        completion_tokens: 50,
        completion_tokens_details: { reasoning_tokens: 5 },
      });
    }
    response.write('data: [DONE]\n\n');
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const apiBase = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/chat/completions`;
  const child = spawn(process.execPath, [
    cliDist,
    '--run',
    'matrix scenario',
    '--project',
    workDir,
    '--api-key',
    'test-key',
    '--api-base',
    apiBase,
    '--auto-approve',
    '--json',
    ...extraArgs,
  ], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AURAXIS_HOME: path.join(workDir, 'auraxis-data'), ...env },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += String(chunk)));
  child.stderr.on('data', (chunk) => (stderr += String(chunk)));
  const code = await new Promise((resolve) => child.on('close', resolve));
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return { code, stdout, stderr };
}

await step('核心库可加载且版本一致', async () => {
  assert.equal(typeof core.runAgent, 'function');
  assert.equal(typeof core.runCodeProgram, 'function');
  assert.equal(typeof core.McpManager, 'function');
});

await step('SecretStore 加密读写删除', async () => {
  const dir = path.join(tempRoot, 'secrets');
  const store = new core.SecretStore(path.join(dir, 'credentials.json'), path.join(dir, 'machine.key'));
  await store.set('TEST_KEY', 'secret-value');
  assert.equal(await store.get('TEST_KEY'), 'secret-value');
  await store.delete('TEST_KEY');
  assert.equal(await store.get('TEST_KEY'), undefined);
});

await step('MemoryStore 记住/搜索/持久化', async () => {
  const dir = path.join(tempRoot, 'memory');
  const store = new core.MemoryStore(path.join(dir, 'memory.json'));
  const record = await store.remember('项目约定', '使用 Node 22+', ['node']);
  assert.match(record.title, /项目约定/);
  const found = await store.search('Node', 5);
  assert.equal(found.length, 1);
  assert.equal((await store.load()).length, 1);
});

await step('SessionMailbox 消息收发', async () => {
  const dir = path.join(tempRoot, 'mailbox');
  const mailbox = new core.SessionMailbox(path.join(dir, 'mailbox.json'));
  await mailbox.send('a', 'b', 'hello');
  const messages = await mailbox.list('b');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'hello');
});

await step('产物发布与列表', async () => {
  const dir = path.join(tempRoot, 'artifacts');
  const file = await core.publishArtifact(dir, 'matrix', 'content');
  assert.equal((await fs.readFile(file, 'utf8')).includes('content'), true);
  assert.equal((await core.listArtifacts(dir)).length, 1);
});

await step('审计记录追加与读取', async () => {
  const dir = path.join(tempRoot, 'audit');
  const audit = new core.AuditStore(path.join(dir, 's1.jsonl'));
  await audit.append({ type: 'tool_end', data: { ok: true } });
  const records = await audit.read();
  assert.equal(records.length, 1);
  assert.equal(records[0].type, 'tool_end');
});

await step('UndoStore 快照恢复', async () => {
  const dir = path.join(tempRoot, 'undo');
  const file = path.join(dir, 'a.txt');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, 'old', 'utf8');
  const undo = new core.UndoStore(path.join(dir, 'store'));
  await undo.push('s1', file, 'old');
  await fs.writeFile(file, 'new', 'utf8');
  const restored = await undo.revertLatest('s1');
  assert.equal(restored?.content, 'old');
  assert.equal(await fs.readFile(file, 'utf8'), 'old');
});

await step('SandboxPolicy 只读限制与路径约束', async () => {
  const dir = path.join(tempRoot, 'sandbox');
  const readOnly = new core.SandboxPolicy({ mode: 'read', projectRoot: dir });
  assert.throws(() => readOnly.assertPath('a.txt'), /只读/);
  assert.throws(() => readOnly.assertPath('../outside'), /超出项目根目录/);
  const write = new core.SandboxPolicy({ mode: 'workspace-write', projectRoot: dir });
  assert.equal(write.assertPath('a.txt'), path.join(dir, 'a.txt'));
});

await step('插件安装/扫描/市场发现', async () => {
  const dir = path.join(tempRoot, 'plugin');
  const source = path.join(dir, 'source');
  await writeTree(source, {
    'plugin.json': JSON.stringify({ id: 'matrix', name: 'Matrix', skills: ['review'] }),
    'skills/review/SKILL.md': '---\nid: review\nname: Review\n---\nRules.',
  });
  await core.installPlugin(source, dir);
  const plugins = await core.scanPlugins(dir, true);
  assert.equal(plugins.length, 1);
  assert.equal(plugins[0].manifest.id, 'matrix');
  const marketplace = path.join(dir, 'marketplace.json');
  await fs.writeFile(marketplace, JSON.stringify([{ id: 'x', name: 'X' }]), 'utf8');
  const previous = process.env.AURAXIS_PLUGIN_MARKETPLACE;
  process.env.AURAXIS_PLUGIN_MARKETPLACE = marketplace;
  assert.equal((await core.discoverMarketplace()).length, 1);
  if (previous === undefined) delete process.env.AURAXIS_PLUGIN_MARKETPLACE;
  else process.env.AURAXIS_PLUGIN_MARKETPLACE = previous;
});

await step('技能扫描与内容读取', async () => {
  const dir = path.join(tempRoot, 'skills');
  await writeTree(dir, {
    '.auraxis/skills/demo/SKILL.md': '---\nid: demo\nname: Demo\n---\nContent.',
  });
  const skills = await core.scanSkills(dir);
  assert.equal(skills.length, 1);
  assert.match(await core.readSkillContent(skills[0]), /Content/);
});

await step('Code Mode 隔离执行与工具组合', async () => {
  const dir = path.join(tempRoot, 'code-mode');
  await fs.mkdir(dir, { recursive: true });
  const result = await core.runCodeProgram(
    'const out = await tools.Write({ file_path: "out.txt", content: "code-ok" });\nconsole.log(out);',
    {
      projectRoot: dir,
      requestId: 'code-matrix',
      executeTool: async (name, input) => {
        assert.equal(name, 'Write');
        await fs.writeFile(path.join(dir, input.file_path), input.content, 'utf8');
        return { output: 'OK' };
      },
      onEvent: () => {},
    },
  );
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /OK/);
  assert.equal(await fs.readFile(path.join(dir, 'out.txt'), 'utf8'), 'code-ok');
});

await step('CLI 工具链：Write → Bash → Read → 结果', async () => {
  const dir = path.join(tempRoot, 'cli-tool-chain');
  const out = await runCliWithMock(dir, [
    { tool: 'Write', args: { file_path: 'hello.txt', content: 'hello matrix' } },
    { tool: 'Bash', args: { command: 'node -e "console.log(123)"', timeoutMs: 10000 } },
    { tool: 'Read', args: { file_path: 'hello.txt' } },
  ]);
  assert.equal(out.code, 0);
  assert.match(out.stdout, /"toolName":"Write"/);
  assert.match(out.stdout, /"toolName":"Bash"/);
  assert.match(out.stdout, /"toolName":"Read"/);
  assert.match(out.stdout, /"text":"<FINAL_ANSWER>matrix-done"/);
  assert.equal(await fs.readFile(path.join(dir, 'hello.txt'), 'utf8'), 'hello matrix');
});

await step('CLI 权限/沙箱：read 模式拒绝 Write', async () => {
  const dir = path.join(tempRoot, 'cli-read-block');
  const out = await runCliWithMock(
    dir,
    [{ tool: 'Write', args: { file_path: 'blocked.txt', content: 'x' } }],
    ['--sandbox', 'read'],
  );
  assert.equal(out.code, 0);
  assert.match(out.stdout, /"tool_error"/);
  await assert.rejects(fs.stat(path.join(dir, 'blocked.txt')));
});

await step('CLI Hooks：pre_tool_use 阻断 Write', async () => {
  const dir = path.join(tempRoot, 'cli-hooks-block');
  await writeTree(dir, {
    'block.js': `let data = '';process.stdin.on('data', (c) => data += c);process.stdin.on('end', () => process.stdout.write(JSON.stringify({ decision: 'block' })));`,
    '.auraxis/hooks.json': JSON.stringify({
      hooks: {
        pre_tool_use: [{ command: 'node block.js' }],
      },
    }),
  });
  const out = await runCliWithMock(
    dir,
    [{ tool: 'Write', args: { file_path: 'blocked.txt', content: 'x' } }],
    [],
    { AURAXIS_TRUST_PROJECT_HOOKS: '1' },
  );
  assert.equal(out.code, 0);
  assert.match(out.stdout, /"tool_error"/);
  await assert.rejects(fs.stat(path.join(dir, 'blocked.txt')));
});

await step('CLI 会话持久化：SessionStore 保存读取', async () => {
  const dir = path.join(tempRoot, 'session');
  const session = await new core.SessionStore({ dir: path.join(dir, 'sessions') })
    .create(dir, 'mock-model', 'deepseek');
  const stored = await new core.SessionStore({ dir: path.join(dir, 'sessions') }).load(session.id);
  assert.equal(stored?.id, session.id);
  assert.equal(stored?.projectRoot, dir);
});

await step('MCP Manager 空配置可启动关闭', async () => {
  const manager = new core.McpManager([]);
  await manager.start();
  assert.equal(manager.errors.length, 0);
  await manager.close();
});

const failed = results.filter((result) => !result.ok);
console.log(`\nmatrix: ${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  for (const failedItem of failed) console.error(`- ${failedItem.name}: ${failedItem.error}`);
  process.exit(1);
}
