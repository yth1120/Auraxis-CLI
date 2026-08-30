import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { runCode } from './code-runtime.js';
import { runCodeProgram } from './codemode.js';
import {
  listBackgroundTasks,
  readBackgroundTask,
  stopBackgroundTask,
} from './tasks.js';
import { unsafeCodeDisabledMessage, unsafeCodeEnabled } from './safe-env.js';
import type { JsonObject } from './types.js';
import type { ToolContext, ToolOutput } from './tools/registry.js';
import { findWorkflow, runWorkflow } from './workflow.js';

export interface InlineWorkflowContext {
  projectRoot: string;
  log: (line: string) => void;
  runSubAgent?: (prompt: string, description?: string) => Promise<string>;
  abortSignal?: AbortSignal;
}

export async function runCodeTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const language = typeof input.language === 'string' ? input.language : '';
  const code = typeof input.code === 'string' ? input.code : '';
  if (!['javascript', 'python', 'shell', 'typescript'].includes(language)) {
    throw new Error('不支持的运行语言，仅支持 javascript / python / shell / typescript');
  }
  if (!code.trim()) throw new Error('code 不能为空');
  const timeoutMs = typeof input.timeout_ms === 'number' && input.timeout_ms > 0 ? input.timeout_ms : undefined;
  if (language === 'typescript') {
    if (!ctx.executeTool) throw new Error('当前运行时不支持 Code Mode 工具编排');
    const result = await runCodeProgram(code, {
      projectRoot: ctx.projectRoot,
      requestId: ctx.sessionId || 'code',
      signal: ctx.signal,
      executeTool: async (name, callInput, _callCtx) => {
        const sub = await ctx.executeTool!(name, callInput);
        return { output: sub.output, error: sub.error };
      },
    }, { timeoutMs });
    return {
      content: JSON.stringify({
        language,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        aborted: result.aborted,
        truncated: result.truncated,
        subCalls: result.subCalls.map((call) => ({
          id: call.id,
          name: call.name,
          status: call.status,
          durationMs: call.durationMs,
          error: call.error,
        })),
      }),
    };
  }
  const result = await runCode({ language: language as 'javascript' | 'python' | 'shell', code, timeoutMs, signal: ctx.signal });
  return { content: JSON.stringify(result) };
}

const WORKFLOW_MAX = 60_000;
const WORKFLOW_TIMEOUT = 600_000;

const WORKFLOW_WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
const { script, projectRoot } = workerData;
const pending = new Map();
let nextId = 1;
function call(method, args) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, (r) => (r.ok ? resolve(r.result) : reject(new Error(r.error || 'RPC failed'))));
    parentPort.postMessage({ type: 'rpc', id, method, args });
  });
}
parentPort.on('message', (m) => {
  if (!m || typeof m.id !== 'number') return;
  const resolve = pending.get(m.id);
  if (resolve) {
    pending.delete(m.id);
    resolve(m);
  }
});
const agents = {
  run: (p) => call('run', [p]),
};
const ctx = {
  projectRoot,
  log: (line) => parentPort.postMessage({ type: 'log', line: String(line) }),
  sleep: (ms) => new Promise((r) => setTimeout(r, Math.max(0, Number(ms) || 0))),
  agents,
};
const sandbox = {
  console: { log: (...a) => ctx.log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) },
  setTimeout, clearTimeout, JSON, Math, Date, Object, Array, String, Number, Boolean,
  Promise, Map, Set, Error, RegExp, Symbol, structuredClone, ctx,
};
(async () => {
  try {
    const compiled = vm.runInNewContext('(async () => {\\n' + script + '\\n})()', sandbox, { timeout: 30000 });
    const output = await compiled;
    parentPort.postMessage({ type: 'result', output: output === undefined ? null : output });
  } catch (e) {
    parentPort.postMessage({ type: 'error', error: String((e && e.message) || e) });
  }
})();
`;

export async function runWorkflowTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  if (!unsafeCodeEnabled()) {
    return { content: JSON.stringify({ ok: false, error: unsafeCodeDisabledMessage('RunWorkflow') }) };
  }
  const script = typeof input.script === 'string' ? input.script.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const projectRoot =
    typeof input.projectRoot === 'string' && input.projectRoot.trim()
      ? path.resolve(ctx.projectRoot, input.projectRoot.trim())
      : ctx.projectRoot;
  if (!script && name) {
    const def = await findWorkflow(projectRoot, name);
    if (!def) return { content: JSON.stringify({ ok: false, error: `未找到工作流: ${name}` }) };
    if (!ctx.runSubAgent) return { content: JSON.stringify({ ok: false, error: '当前运行时不支持工作流子 Agent' }) };
    const logs: string[] = [];
    const result = await runWorkflow(def, {
      runSubAgent: ctx.runSubAgent,
      log: (line) => logs.push(line),
    });
    return { content: JSON.stringify({ ...result, transcript: logs }, null, 2) };
  }
  if (!script) return { content: JSON.stringify({ ok: false, error: '需要 script 或 name' }) };
  if (script.length > WORKFLOW_MAX) return { content: JSON.stringify({ ok: false, error: `脚本过长（${script.length} 字符）` }) };
  const logs: string[] = [];
  const inlineContext: InlineWorkflowContext = {
    projectRoot,
    log: (line) => logs.push(line),
    runSubAgent: ctx.runSubAgent,
    abortSignal: ctx.signal,
  };
  const outcome = await runInlineWorkflow(script, inlineContext);
  return {
    content: JSON.stringify({ ...outcome, transcript: logs }, null, 2),
  };
}

async function runInlineWorkflow(
  script: string,
  ctx: InlineWorkflowContext,
  timeoutMs = WORKFLOW_TIMEOUT,
): Promise<{ ok: boolean; output?: unknown; error?: string }> {
  const worker = new Worker(WORKFLOW_WORKER, {
    eval: true,
    workerData: { script, projectRoot: ctx.projectRoot },
  });
  const api = {
    run: async (p: Record<string, unknown> | undefined) => {
      if (!ctx.runSubAgent) throw new Error('当前运行时未提供子 Agent 能力');
      const prompt = typeof p?.prompt === 'string' ? p.prompt : '';
      const description = typeof p?.description === 'string' ? p.description : '工作流子任务';
      if (!prompt) throw new Error('prompt 不能为空');
      return { id: `agent-${Date.now().toString(36)}`, result: await ctx.runSubAgent(prompt, description) };
    },
  };
  return new Promise((resolve) => {
    let finished = false;
    const finish = (value: { ok: boolean; output?: unknown; error?: string }) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      ctx.abortSignal?.removeEventListener('abort', onAbort);
      void worker.terminate().catch(() => {});
      resolve(value);
    };
    const timer = setTimeout(() => finish({ ok: false, error: '工作流脚本执行超时' }), timeoutMs);
    const onAbort = () => finish({ ok: false, error: '工作流脚本被取消' });
    if (ctx.abortSignal?.aborted) {
      onAbort();
      return;
    }
    ctx.abortSignal?.addEventListener('abort', onAbort, { once: true });
    worker.on('message', (message: unknown) => {
      const msg = message as Record<string, unknown>;
      if (msg?.type === 'log') {
        ctx.log(String(msg.line ?? ''));
      } else if (msg?.type === 'rpc') {
        const fn = (api as Record<string, unknown>)[String(msg.method || '')];
        if (typeof fn !== 'function') {
          worker.postMessage({ id: msg.id, ok: false, error: `未知工作流方法: ${String(msg.method)}` });
          return;
        }
        const args = Array.isArray(msg.args) ? msg.args : [];
        Promise.resolve((fn as (...values: unknown[]) => unknown)(...args))
          .then((value) => worker.postMessage({ id: msg.id, ok: true, result: value }))
          .catch((error) =>
            worker.postMessage({ id: msg.id, ok: false, error: error instanceof Error ? error.message : String(error) }),
          );
      } else if (msg?.type === 'result') {
        finish({ ok: true, output: msg.output });
      } else if (msg?.type === 'error') {
        finish({ ok: false, error: `工作流脚本执行失败: ${String(msg.error ?? '未知错误')}` });
      }
    });
    worker.on('error', (error) =>
      finish({ ok: false, error: `工作流 worker 错误: ${error instanceof Error ? error.message : String(error)}` }),
    );
    worker.on('exit', (code) => {
      if (!finished && code !== 0) finish({ ok: false, error: `工作流 worker 异常退出（code=${code}）` });
    });
  });
}

export async function runTaskTool(input: JsonObject, _ctx: ToolContext): Promise<ToolOutput> {
  const action = typeof input.action === 'string' ? input.action : 'list';
  const id = typeof input.task_id === 'string' ? input.task_id : typeof input.job_id === 'string' ? input.job_id : '';
  if (action === 'list' || action === 'jobs') {
    return { content: JSON.stringify(listBackgroundTasks(), null, 2) };
  }
  if (action === 'output') {
    const task = id ? readBackgroundTask(id) : undefined;
    return task ? { content: JSON.stringify(task, null, 2) } : { content: JSON.stringify({ error: `后台任务不存在: ${id}` }) };
  }
  if (action === 'stop') {
    return { content: JSON.stringify({ ok: id ? stopBackgroundTask(id) : false }) };
  }
  return { content: JSON.stringify({ error: 'unknown task action' }) };
}
