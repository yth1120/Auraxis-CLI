import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-app-server-'));

const server = http.createServer((_request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const payload = {
    id: 'app-server-e2e',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'e2e',
    choices: [{
      index: 0,
      delta: { content: 'hello from app server' },
      finish_reason: 'stop',
    }],
  };
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
  response.write('data: [DONE]\n\n');
  response.end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const apiBase = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/chat/completions`;

const child = spawn(process.execPath, [
  path.join(root, 'packages', 'cli', 'dist', 'main.js'),
  '--app-server',
  '--project',
  workDir,
  '--api-key',
  'test-key',
  '--api-base',
  apiBase,
  '--mode',
  'auto',
  '--sandbox',
  'workspace-write',
], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, AURAXIS_HOME: path.join(workDir, 'auraxis-data') },
});

const lines = [];
const rl = createInterface({ input: child.stdout });
rl.on('line', (line) => lines.push(line));
let stderr = '';
child.stderr.on('data', (chunk) => (stderr += String(chunk)));

async function waitFor(predicate, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = lines.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out; lines=${lines.length}\n${stderr}`);
}

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

try {
  send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} });
  const init = JSON.parse(await waitFor((line) => line.includes('"id":0')));
  if (!init.result?.serverInfo?.name) throw new Error('initialize failed');

  send({ jsonrpc: '2.0', id: 1, method: 'thread/start', params: {} });
  const threadResponse = JSON.parse(await waitFor((line) => line.includes('"id":1')));
  const threadId = threadResponse.result?.thread?.id;
  if (!threadId) throw new Error('thread/start failed');
  if (!lines.some((line) => line.includes('"method":"thread/started"'))) throw new Error('thread/started event missing');

  send({ jsonrpc: '2.0', id: 2, method: 'turn/start', params: { threadId, prompt: 'hello' } });
  const turnResponse = JSON.parse(await waitFor((line) => line.includes('"id":2')));
  if (!turnResponse.result?.ok) throw new Error('turn/start failed');
  if (!lines.some((line) => line.includes('"method":"turn/completed"'))) throw new Error('turn/completed event missing');
  if (!lines.some((line) => line.includes('"method":"item/agentMessage/delta"'))) throw new Error('agent delta event missing');

  send({ jsonrpc: '2.0', id: 3, method: 'thread/list', params: {} });
  const listResponse = JSON.parse(await waitFor((line) => line.includes('"id":3')));
  if (!listResponse.result?.threads?.some((thread) => thread.id === threadId)) throw new Error('thread/list failed');

  send({ jsonrpc: '2.0', id: 4, method: 'thread/archive', params: { threadId } });
  const archiveResponse = JSON.parse(await waitFor((line) => line.includes('"id":4')));
  if (!archiveResponse.result?.ok) throw new Error('thread/archive failed');

  console.log('app server e2e ok');
} finally {
  child.stdin.end();
  await new Promise((resolve) => child.on('close', resolve));
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
