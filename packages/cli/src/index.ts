#!/usr/bin/env node

import { parseArgs, usage } from './args.js';
import { loadRuntimeConfig, getAppPaths, type RuntimeConfig } from '@auraxis/core';
import { chatMessageText, SecretStore, SessionStore, getTools, runAgent, type AgentEvent, type ChatMessage, type SessionRecord } from '@auraxis/core';
import path from 'node:path';

const VERSION = '0.1.0';

async function resolveApiKey(config: RuntimeConfig): Promise<string> {
  if (config.apiKey) return config.apiKey;
  const paths = getAppPaths();
  const store = new SecretStore(paths.credentialsFile, paths.keyFile);
  const stored = await store.get('DEEPSEEK_API_KEY').catch(() => undefined);
  return stored || '';
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
  console.log(`API: ${config.apiBase}`);
  console.log(`API Key: ${apiKey ? '已配置' : '未配置'}`);
  console.log(`权限模式: ${config.mode}`);
  console.log(`沙箱: ${config.sandboxMode}`);
  console.log(`工具数: ${getTools().length}`);
  return 0;
}

async function runHeadless(args: ReturnType<typeof parseArgs>): Promise<number> {
  const config = await loadRuntimeConfig({
    project: args.project,
    model: args.model,
    apiKey: args.apiKey,
    apiBase: args.apiBase,
    mode: args.mode,
    sandbox: args.sandbox,
    deepThink: args.deepThink,
    reasoningEffort: args.reasoningEffort,
    maxIterations: args.maxIterations,
    toolChoice: args.toolChoice,
  });
  const apiKey = await resolveApiKey(config);
  if (!apiKey) {
    console.error('未配置 API Key。请设置 DEEPSEEK_API_KEY、AURAXIS_API_KEY 或使用 --api-key。');
    return 2;
  }
  const store = makeSessionStore();
  const existing = args.session ? await store.load(args.session) : null;
  const session = existing || (await store.create(config.projectRoot, config.model));
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

  const result = await runAgent({
    prompt: args.run || '',
    projectRoot: config.projectRoot,
    model: config.model,
    apiKey,
    apiBase: config.apiBase,
    mode: config.mode,
    sandboxMode: config.sandboxMode,
    maxIterations: config.maxIterations,
    deepThink: config.deepThink,
    reasoningEffort: config.reasoningEffort,
    toolChoice: config.toolChoice,
    tools: getTools(),
    sessionId: session.id,
    resumeMessages,
    onEvent: eventStream,
    requestPermission: permission,
    onPlanApproval: async () => (args.approvePlan ? 'approve' : 'reject'),
  });

  session.messages = result.messages;
  session.summary = result.text.slice(0, 500);
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exitCode = 0;
    return;
  }
  if (args.version) {
    console.log(VERSION);
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
  if (args.run) {
    process.exitCode = await runHeadless(args);
    return;
  }

  const { runInteractive } = await import('./ui/app.js');
  process.exitCode = await runInteractive(args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
