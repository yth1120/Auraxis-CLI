import { Worker } from 'node:worker_threads';
import ts from 'typescript5';
import { isToolConcurrencySafe } from './tools/registry.js';
import { unsafeCodeEnabled, unsafeCodeDisabledMessage } from './safe-env.js';
import type { JsonObject } from './types.js';

export interface CodeModeSubCall {
  id: number;
  name: string;
  input: JsonObject;
  status: 'running' | 'done' | 'error' | 'aborted';
  output?: unknown;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
}

export interface CodeModeResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  truncated: boolean;
  subCalls: CodeModeSubCall[];
}

export type CodeModeEvent =
  | { type: 'code_start' }
  | { type: 'code_log'; line: string }
  | { type: 'code_tool_start'; call: CodeModeSubCall }
  | { type: 'code_tool_end'; call: CodeModeSubCall }
  | { type: 'code_tool_error'; call: CodeModeSubCall }
  | { type: 'code_done'; result: CodeModeResult };

export interface CodeModeExecuteResult {
  output: unknown;
  error?: string;
}

export interface CodeModeHost {
  projectRoot: string;
  requestId: string;
  signal?: AbortSignal;
  onEvent?: (event: CodeModeEvent) => void;
  /** 子调用入口：由调用方接权限门 / MCP / 工具注册表。 */
  executeTool: (
    name: string,
    input: JsonObject,
    ctx: { projectRoot: string; requestId: string; signal: AbortSignal },
  ) => Promise<CodeModeExecuteResult>;
}

export interface CodeModeOptions {
  timeoutMs?: number;
  outputCap?: number;
  executeTool?: CodeModeHost['executeTool'];
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_CAP = 50_000;
const MAX_PARALLEL_SUB_CALLS = 8;
const MAX_CODE_LENGTH = 200_000;
const MAX_SUB_CALL_INPUT_BYTES = 100_000;

function transpileProgram(source: string): string {
  const out = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      erasableSyntaxOnly: true,
      strict: true,
    },
    reportDiagnostics: true,
  });
  const errors = (out.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    const detail = errors
      .slice(0, 5)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('; ');
    throw new Error(`TypeScript 语法错误: ${detail}`);
  }
  return out.outputText;
}

/**
 * Replicate the desktop Code Mode runtime: the model program runs in a
 * worker thread with only `tools` and `console` injected, sub-calls re-enter
 * the full permission pipeline on the host, and the host schedules parallel
 * sub-calls with the same concurrency-safe rules.
 */
function workerSource(code: string): string {
  return [
    "'use strict';",
    "const { parentPort } = require('node:worker_threads');",
    'const pending = new Map();',
    'let nextId = 1;',
    'function call(name, input) {',
    '  const id = nextId++;',
    '  return new Promise((resolve, reject) => {',
    '    pending.set(id, { resolve, reject });',
    "    parentPort.postMessage({ k: 'call', id, name, input: input && typeof input === 'object' ? input : {} });",
    '  });',
    '}',
    'const tools = new Proxy({}, {',
    '  get(_target, prop) {',
    '    const name = String(prop);',
    "    if (name === 'then') return undefined;",
    '    return (input) => call(name, input && typeof input === \"object\" ? input : {});',
    '  },',
    '});',
    'function format(v) {',
    "  if (typeof v === 'string') return v;",
    "  try { return JSON.stringify(v); } catch { return String(v); }",
    '}',
    'const print = (...args) => parentPort.postMessage({ k: "log", line: args.map(format).join(" ") + "\\n" });',
    'const console = { log: print, error: print, warn: print, info: print };',
    "parentPort.on('message', (m) => {",
    "  if (!m || m.k !== 'res') return;",
    '  const p = pending.get(m.id);',
    '  if (!p) return;',
    '  pending.delete(m.id);',
    "  if (m.error) p.reject(new Error(m.error)); else p.resolve(m.output);",
    '});',
    '(async () => {',
    '  try {',
    '    try {',
    '      const g = globalThis;',
    '      g.require = undefined;',
    '      g.process = undefined;',
    '      g.Buffer = undefined;',
    '      g.module = undefined;',
    '      g.exports = undefined;',
    '      g.__dirname = undefined;',
    '      g.__filename = undefined;',
    '      g.global = undefined;',
    '      g.eval = undefined;',
    '    } catch { /* best-effort */ }',
    '    const fn = new Function("tools", "console", "\\"use strict\\"; return (async () => {\\n" + CODE + "\\n})();");',
    '    globalThis.Function = undefined;',
    '    const result = await fn(tools, console);',
    "    const text = result === undefined ? '' : (typeof result === 'string' ? result : format(result));",
    "    parentPort.postMessage({ k: 'done', value: text });",
    '  } catch (e) {',
    "    parentPort.postMessage({ k: 'error', error: String((e && e.message) || e), stack: String((e && e.stack) || '').slice(0, 1200) });",
    '  }',
    '})();',
  ].join('\n').replace('CODE', () => JSON.stringify(code));
}

export async function runCodeProgram(
  code: string,
  host: CodeModeHost,
  opts: CodeModeOptions = {},
): Promise<CodeModeResult> {
  if (!unsafeCodeEnabled()) {
    return {
      stdout: '',
      stderr: unsafeCodeDisabledMessage('Code Mode'),
      exitCode: 1,
      timedOut: false,
      aborted: false,
      truncated: false,
      subCalls: [],
    };
  }
  if (typeof code !== 'string' || !code.trim()) {
    return {
      stdout: '',
      stderr: 'Code Mode 程序不能为空',
      exitCode: 1,
      timedOut: false,
      aborted: false,
      truncated: false,
      subCalls: [],
    };
  }
  if (code.length > MAX_CODE_LENGTH) {
    return {
      stdout: '',
      stderr: `Code Mode 程序超过 ${MAX_CODE_LENGTH} 字符限制`,
      exitCode: 1,
      timedOut: false,
      aborted: false,
      truncated: false,
      subCalls: [],
    };
  }
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const outputCap = opts.outputCap && opts.outputCap > 0 ? opts.outputCap : DEFAULT_OUTPUT_CAP;
  const executeTool = opts.executeTool ?? host.executeTool;
  const projectRoot = host.projectRoot;
  const requestId = host.requestId;
  const signal = host.signal ?? new AbortController().signal;
  const transpiled = transpileProgram(code);
  const worker = new Worker(workerSource(transpiled), {
    eval: true,
    env: {},
    execArgv: [],
    resourceLimits: {
      maxOldGenerationSizeMb: 128,
      maxYoungGenerationSizeMb: 32,
    },
  });
  host.onEvent?.({ type: 'code_start' });

  const subCalls: CodeModeSubCall[] = [];
  const out = { value: '' };
  const err = { value: '' };
  let truncated = false;
  let timedOut = false;
  let aborted = false;
  let exitCode: number | null = 0;

  const queue: Array<{ id: number; name: string; input: JsonObject }> = [];
  let active = 0;
  let unsafeActive = 0;
  const pump = () => {
    while (queue.length > 0 && active < MAX_PARALLEL_SUB_CALLS) {
      const next = queue[0];
      const safe = isToolConcurrencySafe(next.name);
      if (!safe && unsafeActive > 0) break;
      queue.shift();
      active += 1;
      if (!safe) unsafeActive += 1;
      void runSubCall(next);
    }
  };

  const runSubCall = async (item: { id: number; name: string; input: JsonObject }) => {
    const safe = isToolConcurrencySafe(item.name);
    const entry: CodeModeSubCall = {
      id: item.id,
      name: item.name,
      input: item.input,
      status: 'running',
      startedAt: Date.now(),
    };
    subCalls.push(entry);
    host.onEvent?.({ type: 'code_tool_start', call: entry });
    if (signal.aborted) {
      entry.status = 'aborted';
      entry.finishedAt = Date.now();
      entry.durationMs = 0;
      worker.postMessage({ k: 'res', id: item.id, output: null, error: '程序已中止' });
      active -= 1;
      if (!safe) unsafeActive -= 1;
      pump();
      return;
    }
    try {
      const result = await executeTool(item.name, item.input, {
        projectRoot,
        requestId,
        signal,
      });
      entry.output = result.output;
      entry.status = result.error ? 'error' : 'done';
      entry.error = result.error;
      worker.postMessage({ k: 'res', id: item.id, output: result.output, error: result.error });
      if (result.error) host.onEvent?.({ type: 'code_tool_error', call: entry });
      else host.onEvent?.({ type: 'code_tool_end', call: entry });
    } catch (err) {
      entry.status = 'error';
      entry.error = err instanceof Error ? err.message : String(err);
      worker.postMessage({ k: 'res', id: item.id, output: null, error: entry.error });
      host.onEvent?.({ type: 'code_tool_error', call: entry });
    } finally {
      entry.finishedAt = Date.now();
      entry.durationMs = entry.finishedAt - entry.startedAt;
      active -= 1;
      if (!safe) unsafeActive -= 1;
      pump();
    }
  };

  const append = (target: { value: string }, chunk: string) => {
    if (target.value.length >= outputCap) {
      truncated = true;
      return;
    }
    const remaining = outputCap - target.value.length;
    target.value += chunk.slice(0, remaining);
    if (chunk.length > remaining) truncated = true;
  };

  return new Promise<CodeModeResult>((resolve) => {
    let settled = false;
    const finish = (patch: Partial<CodeModeResult>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      void worker.terminate();
      const result: CodeModeResult = {
        stdout: out.value,
        stderr: err.value,
        exitCode,
        timedOut,
        aborted,
        truncated,
        subCalls,
        ...patch,
      };
      host.onEvent?.({ type: 'code_done', result });
      resolve(result);
    };

    const onAbort = () => {
      aborted = true;
      finish({ aborted: true, exitCode: null });
    };
    signal.addEventListener('abort', onAbort);

    const timer = setTimeout(() => {
      timedOut = true;
      finish({
        timedOut: true,
        exitCode: null,
        stderr: err.value ? `${err.value}\n程序超时，已强制终止` : '程序超时，已强制终止',
      });
    }, timeoutMs);
    if (signal.aborted) {
      onAbort();
      return;
    }

    worker.on('message', (message) => {
      if (settled) return;
      if (message?.k === 'call') {
        const input = (message.input || {}) as JsonObject;
        if (JSON.stringify(input).length > MAX_SUB_CALL_INPUT_BYTES) {
          worker.postMessage({
            k: 'res',
            id: message.id,
            output: null,
            error: `工具输入超过 ${MAX_SUB_CALL_INPUT_BYTES} 字符限制`,
          });
          return;
        }
        queue.push({ id: message.id, name: String(message.name || ''), input });
        pump();
      } else if (message?.k === 'log') {
        append(out, String(message.line || ''));
        host.onEvent?.({ type: 'code_log', line: String(message.line || '') });
      } else if (message?.k === 'done') {
        append(out, String(message.value || ''));
        finish({ exitCode: 0 });
      } else if (message?.k === 'error') {
        err.value = `${message.error || 'Code Mode 执行失败'}${message.stack ? `\n${message.stack}` : ''}`;
        exitCode = 1;
        finish({ exitCode: 1 });
      }
    });
    worker.on('error', (error) => {
      const detail = error instanceof Error ? error.message : String(error);
      err.value = err.value ? `${err.value}\n${detail}` : detail;
      exitCode = 1;
      finish({ exitCode: 1 });
    });
    worker.on('exit', () => {
      if (!settled) finish({ exitCode: null });
    });
  });
}
