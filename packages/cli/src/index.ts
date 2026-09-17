#!/usr/bin/env node

import { apiKeyEnvName, parseArgs, usage } from './args.js';
import { CLI_VERSION } from './version.js';
import { loadRuntimeConfig, getAppPaths, type RuntimeConfig, AppServer } from '@auraxis/core';
import {
  chatMessageText,
  DeepSeekClient,
  DeepSeekFilesClient,
  getTool,
  SecretStore,
  SessionStore,
  getTools,
  loadMcpServers,
  McpManager,
  runAgent,
  runCodeProgram,
  summarizeToolInput,
  UndoStore,
  MemoryStore,
  SandboxPolicy,
  SessionMailbox,
  LspManager,
  type AgentEvent,
  type ChatMessage,
  type CodeModeEvent,
  type CodeModeHost,
  type JsonObject,
  type RunResult,
  type SessionRecord,
} from '@auraxis/core';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';

async function resolveApiKey(config: RuntimeConfig): Promise<string> {
  if (config.apiKey) return config.apiKey;
  const paths = getAppPaths();
  const store = new SecretStore(paths.credentialsFile, paths.keyFile);
  const names = ['AURAXIS_API_KEY', apiKeyEnvName(config.provider)];
  for (const name of names) {
    const stored = await store.get(name).catch(() => undefined);
    if (stored) return stored;
  }
  return '';
}

function makeSessionStore(): SessionStore {
  return new SessionStore({ dir: path.join(getAppPaths().sessionsDir) });
}

function formatSession(session: SessionRecord): string {
  const date = new Date(session.updatedAt).toLocaleString();
  const last = session.messages.at(-1);
  const firstUser = session.messages.find((message) => message.role === 'user');
  return `${session.id}  ${date}  ${chatMessageText(firstUser?.content).slice(0, 60) || '(空会话)'}${last ? `  [${session.messages.length} messages]` : ''}`;
}

async function listSessions(): Promise<number> {
  const sessions = await makeSessionStore().list();
  if (!sessions.length) {
    console.log('暂无会话');
    return 0;
  }
  for (const session of sessions) {
    console.log(formatSession(session));
  }
  return 0;
}

async function doctor(): Promise<number> {
  const config = await loadRuntimeConfig();
  const apiKey = await resolveApiKey(config);
  console.log(`项目: ${config.projectRoot}`);
  console.log(`模型: ${config.model}`);
  console.log(`供应商: ${config.provider}`);
  console.log(`接口协议: ${config.apiFamily}`);
  console.log(`API: ${config.apiBase}`);
  console.log(`API Key: ${apiKey ? '已配置' : '未配置'}`);
  console.log(`权限模式: ${config.mode}`);
  console.log(`沙箱: ${config.sandboxMode}`);
  console.log(`上下文预算: ${config.contextBudget}`);
  console.log(`工具轮次上限: ${config.maxSteps < 0 ? 'unlimited' : config.maxSteps}`);
  console.log(`视觉精度: ${config.visionDetail}`);
  console.log(`Strict Tools: ${config.strictTools ? 'on' : 'off'}`);
  console.log(`工具数: ${getTools().length}`);
  console.log(`自定义模型: ${config.customModels.length}`);
  return 0;
}

async function runAppServer(args: ReturnType<typeof parseArgs>): Promise<number> {
  const config = await loadRuntimeConfig({
    project: args.project,
    model: args.model,
    provider: args.provider,
    apiFamily: args.apiFamily,
    apiKey: args.apiKey,
    apiBase: args.apiBase,
    mode: args.mode,
    sandbox: args.sandbox,
    visionDetail: args.visionDetail,
    strictTools: args.strictTools,
    reasoningEffort: args.reasoningEffort,
    thinking: args.thinking,
    maxTokens: args.maxTokens,
    maxSteps: args.maxSteps,
    contextBudget: args.contextBudget,
    toolChoice: args.toolChoice,
  });
  const apiKey = await resolveApiKey(config);
  const server = new AppServer({
    projectRoot: config.projectRoot,
    model: config.model,
    provider: config.provider,
    apiFamily: config.apiFamily,
    apiKey,
    apiBase: config.apiBase,
    headers: config.headers,
    supportsImages: config.supportsImages,
    mode: config.mode,
    sandboxMode: config.sandboxMode,
    reasoningEffort: config.reasoningEffort,
    toolChoice: config.toolChoice,
    visionDetail: config.visionDetail,
    strictTools: config.strictTools,
    thinking: config.thinking,
    maxTokens: config.maxTokens,
    maxSteps: config.maxSteps,
    contextBudget: config.contextBudget,
    autoApprove: args.autoApprove,
    approvePlan: args.approvePlan,
  });
  await server.start();
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  return new Promise<number>((resolve) => {
    rl.on('line', async (line) => {
      try {
        const outputs = await server.handleLine(line.trim());
        for (const output of outputs) process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      }
    });
    rl.on('close', async () => {
      await server.close().catch(() => {});
      resolve(0);
    });
  });
}

async function runHeadless(args: ReturnType<typeof parseArgs>): Promise<number> {
  const config = await loadRuntimeConfig({
    project: args.project,
    model: args.model,
    provider: args.provider,
    apiFamily: args.apiFamily,
    apiKey: args.apiKey,
    apiBase: args.apiBase,
    mode: args.mode,
    sandbox: args.sandbox,
    visionDetail: args.visionDetail,
    strictTools: args.strictTools,
    reasoningEffort: args.reasoningEffort,
    thinking: args.thinking,
    maxTokens: args.maxTokens,
    maxSteps: args.maxSteps ?? 200,
    contextBudget: args.contextBudget,
    toolChoice: args.toolChoice,
  });
  const apiKey = await resolveApiKey(config);
  if (!apiKey) {
    console.error('未配置 API Key。请设置 AURAXIS_API_KEY、DEEPSEEK_API_KEY、ANTHROPIC_API_KEY、GEMINI_API_KEY 或使用 --api-key。');
    return 2;
  }
  const store = makeSessionStore();
  const mcpManager = new McpManager(await loadMcpServers(config.projectRoot));
  await mcpManager.start();
  for (const error of mcpManager.errors) {
    process.stderr.write(`[MCP] ${error}\n`);
  }
  const existing = args.session ? await store.load(args.session) : null;
  const session = existing || (await store.create(config.projectRoot, config.model, config.provider));
  const resumeMessages: ChatMessage[] = existing ? existing.messages : [];

  const eventStream = (event: AgentEvent) => {
    if (args.json) {
      console.log(JSON.stringify({ ...event, ts: Date.now() }));
      return;
    }
    switch (event.type) {
      case 'text_chunk':
        process.stdout.write(event.text);
        break;
      case 'thinking_chunk':
        if (event.chunk.trim()) process.stderr.write(`[思考] ${event.chunk.trim().split('\n')[0].slice(0, 120)}\n`);
        break;
      case 'tool_start':
        process.stderr.write(`[工具] ${event.toolName}\n`);
        break;
      case 'tool_end':
        process.stderr.write(`[完成] ${event.toolName} (${event.durationMs}ms)\n`);
        break;
      case 'tool_error':
        process.stderr.write(`[失败] ${event.toolName}: ${event.error}\n`);
        break;
      case 'plan_created':
        process.stderr.write(`[计划] ${event.plan.tasks.length} 个任务\n`);
        break;
      case 'error':
        process.stderr.write(`[错误] ${event.error}\n`);
        break;
      default:
        break;
    }
  };

  const permission = async (request: { tool: string; summary: string }) => {
    if (args.autoApprove || config.mode === 'auto') return 'allow_once' as const;
    process.stderr.write(`[权限] 默认拒绝: ${request.tool} ${request.summary}\n`);
    return 'deny' as const;
  };

  let result: RunResult;
  try {
    result = await runAgent({
      prompt: args.run || '',
      projectRoot: config.projectRoot,
      model: config.model,
      provider: config.provider,
      apiFamily: config.apiFamily,
      apiKey,
      apiBase: config.apiBase,
      headers: config.headers,
      supportsImages: config.supportsImages,
      mode: config.mode,
      sandboxMode: config.sandboxMode,
      maxTokens: config.maxTokens,
      maxSteps: config.maxSteps,
      contextBudget: config.contextBudget,
      reasoningEffort: config.reasoningEffort,
      thinking: config.thinking,
      toolChoice: config.toolChoice,
      visionDetail: config.visionDetail,
      strictTools: config.strictTools,
      tools: [...getTools(), ...mcpManager.getToolDefinitions()],
      mcp: mcpManager,
      sessionId: session.id,
      resumeMessages,
      onEvent: eventStream,
      requestPermission: permission,
      onPlanApproval: async () => (args.approvePlan ? 'approve' : 'reject'),
    });
  } finally {
    await mcpManager.close().catch(() => {});
  }

  session.messages = result.messages;
  session.summary = result.text.slice(0, 500);
  session.provider = config.provider;
  await store.save(session);

  if (args.json) {
    console.log(JSON.stringify({
      type: 'result',
      ok: !result.aborted,
      text: result.text,
      iterations: result.iterations,
      toolCallCount: result.toolCallCount,
      sessionId: session.id,
    }));
  } else {
    if (result.text && !result.text.endsWith('\n')) process.stdout.write('\n');
    process.stderr.write(`[结果] 轮次=${result.iterations} 工具=${result.toolCallCount} session=${session.id}\n`);
  }
  return result.aborted ? 130 : 0;
}

async function runCodeHeadless(args: ReturnType<typeof parseArgs>): Promise<number> {
  const config = await loadRuntimeConfig({
    project: args.project,
    model: args.model,
    apiFamily: args.apiFamily,
    apiKey: args.apiKey,
    apiBase: args.apiBase,
    mode: args.mode,
    sandbox: args.sandbox,
    visionDetail: args.visionDetail,
    strictTools: args.strictTools,
    reasoningEffort: args.reasoningEffort,
    thinking: args.thinking,
    maxTokens: args.maxTokens,
    maxSteps: args.maxSteps ?? 200,
    toolChoice: args.toolChoice,
  });
  const codePath = path.resolve(config.projectRoot, args.code || '');
  const apiKey = await resolveApiKey(config);
  let code: string;
  try {
    code = await readFile(codePath, 'utf8');
  } catch {
    console.error(`无法读取 Code Mode 文件: ${codePath}`);
    return 2;
  }

  const mcpManager = new McpManager(await loadMcpServers(config.projectRoot));
  await mcpManager.start();
  for (const error of mcpManager.errors) {
    process.stderr.write(`[MCP] ${error}\n`);
  }
  let codeLsp: LspManager | null = null;
  try {
    const undo = new UndoStore(path.join(getAppPaths().home, 'undo'));
    codeLsp = await LspManager.fromEnv(config.projectRoot);
    const executeTool: CodeModeHost['executeTool'] = async (name, input, ctx) => {
      const staticTool = getTool(name);
      const mcpDefinition = mcpManager.getDefinition(name);
      if (!staticTool && !mcpDefinition) return { output: null, error: `未知工具: ${name}` };
      const decision = args.autoApprove || config.mode === 'auto' ? 'allow_once' : 'deny';
      if (decision === 'deny') {
        process.stderr.write(`[权限] 默认拒绝: ${name} ${summarizeToolInput(name, input)}\n`);
        return { output: null, error: `用户拒绝执行 ${name}` };
      }
      if (staticTool) {
        const output = await staticTool.runner(input, {
          projectRoot: config.projectRoot,
          sessionId: ctx.requestId,
          files: new DeepSeekFilesClient({
            provider: config.provider,
            apiKey,
            apiBase: config.apiBase,
            headers: config.headers,
          }),
          supportsImages: config.supportsImages,
          visionDetail: config.visionDetail,
          undo,
          memory: MemoryStore.project(config.projectRoot),
          mailbox: SessionMailbox.global(),
          lsp: codeLsp || undefined,
          sandbox: new SandboxPolicy({ mode: config.sandboxMode, projectRoot: config.projectRoot }),
          emit: () => {},
          todos: [],
          setTodos: () => {},
          signal: ctx.signal,
          mcp: mcpManager,
        });
        return { output: output.content };
      }
      return { output: await mcpManager.call(mcpDefinition!.mcpServer!, name, input as JsonObject) };
    };

    const onEvent = (event: CodeModeEvent) => {
      if (args.json) {
        console.log(JSON.stringify({ ...event, ts: Date.now() }));
        return;
      }
      switch (event.type) {
        case 'code_log':
          process.stdout.write(event.line);
          break;
        case 'code_tool_start':
          process.stderr.write(`[代码→工具] ${event.call.name}\n`);
          break;
        case 'code_tool_end':
          process.stderr.write(`[代码→完成] ${event.call.name} (${event.call.durationMs}ms)\n`);
          break;
        case 'code_tool_error':
          process.stderr.write(`[代码→失败] ${event.call.name}: ${event.call.error}\n`);
          break;
        case 'code_done':
          process.stderr.write(`[代码完成] exit=${event.result.exitCode} tools=${event.result.subCalls.length}\n`);
          break;
        default:
          break;
      }
    };

    const result = await runCodeProgram(code, {
      projectRoot: config.projectRoot,
      requestId: `code-${Date.now().toString(36)}`,
      onEvent,
      executeTool,
    });
    if (args.json) {
      console.log(
        JSON.stringify({
          type: 'code_result',
          ok: result.exitCode === 0,
          stdout: result.stdout.slice(0, 5000),
          stderr: result.stderr.slice(0, 2000),
          timedOut: result.timedOut,
          aborted: result.aborted,
          subCalls: result.subCalls.length,
        }),
      );
    } else {
      if (result.stdout && !result.stdout.endsWith('\n')) process.stdout.write('\n');
      process.stderr.write(
        `[结果] exit=${result.exitCode} timedOut=${result.timedOut} aborted=${result.aborted} tools=${result.subCalls.length}\n`,
      );
    }
    return result.exitCode === 0 ? 0 : 1;
  } finally {
    await mcpManager.close().catch(() => {});
    await codeLsp?.close().catch(() => {});
  }
}

async function runCompletionHeadless(args: ReturnType<typeof parseArgs>): Promise<number> {
  const config = await loadRuntimeConfig({
    project: args.project,
    model: args.model,
    provider: args.provider,
    apiFamily: args.apiFamily,
    apiKey: args.apiKey,
    apiBase: args.apiBase,
  });
  const apiKey = await resolveApiKey(config);
  if (!apiKey) {
    console.error('未配置 API Key。请设置 DEEPSEEK_API_KEY 或使用 --api-key。');
    return 2;
  }
  const client = new DeepSeekClient(
    apiKey,
    config.apiBase,
    config.model,
    config.maxTokens,
    3,
    true,
    config.strictTools,
    config.headers,
  );
  try {
    const completion = args.complete
      ? await client.completePrefix({ prefix: args.complete, maxTokens: config.maxTokens })
      : await client.completeFim({
          prompt: (args.fim || '').split('||')[0] || '',
          suffix: (args.fim || '').includes('||') ? (args.fim || '').split('||')[1] : undefined,
          maxTokens: Math.min(config.maxTokens, 4096),
        });
    if (completion) process.stdout.write(`${completion}${completion.endsWith('\n') ? '' : '\n'}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function runFilesHeadless(args: ReturnType<typeof parseArgs>): Promise<number> {
  const config = await loadRuntimeConfig({
    project: args.project,
    model: args.model,
    provider: args.provider,
    apiFamily: args.apiFamily,
    apiKey: args.apiKey,
    apiBase: args.apiBase,
  });
  const apiKey = await resolveApiKey(config);
  if (!apiKey) {
    console.error('未配置 API Key。请设置 DEEPSEEK_API_KEY 或使用 --api-key。');
    return 2;
  }
  const client = new DeepSeekFilesClient({
    provider: config.provider,
    apiKey,
    apiBase: config.apiBase,
    headers: config.headers,
  });
  const [action = 'list', ...rest] = ((args.filesArgs?.join(' ') || args.files || 'list')
    .trim()
    .split(/\s+/)
    .filter((part) => part && !part.startsWith('--')) || []);
  try {
    if (action === 'list') {
      const result = await client.list();
      console.log(
        result.data.length
          ? result.data.map((file) => `${file.id} · ${file.filename || '图片'} · ${Math.round(file.bytes / 1024)}KB`).join('\n')
          : '暂无已上传文件',
      );
    } else if (action === 'upload' && rest[0]) {
      const filePath = path.resolve(config.projectRoot, rest[0]);
      const name = path.basename(filePath);
      const extension = path.extname(filePath).toLowerCase();
      const mimeType =
        extension === '.png'
          ? 'image/png'
          : extension === '.gif'
            ? 'image/gif'
            : extension === '.webp'
              ? 'image/webp'
              : 'image/jpeg';
      const uploaded = await client.upload({ name, buffer: await readFile(filePath), mimeType });
      console.log(`${uploaded.id} · ${uploaded.filename || name}`);
    } else if (action === 'info' && rest[0]) {
      const file = await client.retrieve(rest[0]);
      console.log(`${file.id} · ${file.filename || '图片'} · ${Math.round(file.bytes / 1024)}KB`);
    } else if (action === 'delete' && rest[0]) {
      const result = await client.delete(rest[0]);
      console.log(`已删除 ${result.id}`);
    } else {
      console.error('用法: --files list | upload <path> | info <id> | delete <id>');
      return 2;
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.setApiKey) {
    const paths = getAppPaths();
    const store = new SecretStore(paths.credentialsFile, paths.keyFile);
    const keyName = apiKeyEnvName(args.provider);
    await store.set(keyName, args.setApiKey);
    console.log(`${keyName} 已加密保存`);
    process.exitCode = 0;
    return;
  }
  if (args.help) {
    console.log(usage());
    process.exitCode = 0;
    return;
  }
  if (args.version) {
    console.log(CLI_VERSION);
    process.exitCode = 0;
    return;
  }
  if (args.sessions) {
    process.exitCode = await listSessions();
    return;
  }
  if (args.doctor) {
    process.exitCode = await doctor();
    return;
  }
  if (args.appServer) {
    process.exitCode = await runAppServer(args);
    return;
  }
  if (args.complete || args.fim) {
    process.exitCode = await runCompletionHeadless(args);
    return;
  }
  if (args.files) {
    process.exitCode = await runFilesHeadless(args);
    return;
  }
  if (args.run) {
    process.exitCode = await runHeadless(args);
    return;
  }
  if (args.code) {
    process.exitCode = await runCodeHeadless(args);
    return;
  }

  const { runInteractive } = await import('./ui/app.js');
  process.exitCode = await runInteractive(args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
