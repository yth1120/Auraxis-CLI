import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { safeProcessEnv } from './safe-env.js';

export type BackgroundTaskStatus = 'running' | 'success' | 'failed' | 'stopped' | 'timeout';

export interface BackgroundTask {
  id: string;
  kind: 'bash' | 'terminal' | 'agent';
  name: string;
  command?: string;
  status: BackgroundTaskStatus;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  durationMs?: number;
  error?: string;
  output: string;
}

interface InternalTask extends BackgroundTask {
  abort?: () => void;
}

const MAX_TASKS = 200;
const MAX_OUTPUT = 500_000;
const tasks = new Map<string, InternalTask>();

function append(record: InternalTask, key: 'output', text: string): void {
  if (record[key].length >= MAX_OUTPUT) return;
  record[key] = `${record[key]}${text}`.slice(0, MAX_OUTPUT);
}

function settle(
  record: InternalTask,
  status: BackgroundTaskStatus,
  exitCode: number | null,
  error?: string,
): void {
  record.status = status;
  record.exitCode = exitCode;
  record.error = error;
  record.finishedAt = Date.now();
  record.durationMs = record.finishedAt - record.startedAt;
  record.abort = undefined;
}

export function listBackgroundTasks(): BackgroundTask[] {
  return [...tasks.values()]
    .map(({ abort: _abort, ...record }) => ({ ...record }))
    .reverse();
}

export function startBackgroundCommand(options: {
  command: string;
  name?: string;
  cwd: string;
  timeoutMs?: number;
}): BackgroundTask {
  const id = randomUUID();
  const startedAt = Date.now();
  const record: InternalTask = {
    id,
    kind: 'bash',
    name: options.name || options.command.slice(0, 80),
    command: options.command,
    status: 'running',
    startedAt,
    output: '',
  };
  tasks.set(id, record);
  if (tasks.size > MAX_TASKS) {
    const oldest = [...tasks.values()].find((item) => item.status !== 'running');
    if (oldest) tasks.delete(oldest.id);
  }
  try {
    const child = spawn(options.command, {
      cwd: options.cwd,
      windowsHide: true,
      env: safeProcessEnv(),
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    record.abort = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* gone */
      }
    };
    child.stdout.on('data', (chunk) => append(record, 'output', String(chunk)));
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      append(record, 'output', text);
      if (!record.error) record.error = text.trim().slice(0, 500) || undefined;
    });
    child.on('error', (error) => {
      if (record.status === 'running') settle(record, 'failed', null, error.message);
    });
    child.on('close', (code) => {
      if (record.status !== 'running') return;
      settle(record, code === 0 ? 'success' : 'failed', code, record.error);
    });
    const timer = setTimeout(() => {
      if (record.status !== 'running') return;
      record.abort?.();
      settle(record, 'timeout', null, '后台命令超时');
    }, options.timeoutMs || 600_000);
    timer.unref?.();
  } catch (error) {
    if (record.status === 'running') {
      settle(record, 'failed', null, error instanceof Error ? error.message : String(error));
    }
  }
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    command: record.command,
    status: record.status,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    exitCode: record.exitCode,
    durationMs: record.durationMs,
    error: record.error,
    output: record.output,
  };
}

export function stopBackgroundTask(id: string): boolean {
  const record = tasks.get(id);
  if (!record || record.status !== 'running') return false;
  record.abort?.();
  settle(record, 'stopped', null, '用户中止');
  return true;
}

export function readBackgroundTask(id: string): BackgroundTask | undefined {
  const record = tasks.get(id);
  if (!record) return undefined;
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    command: record.command,
    status: record.status,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    exitCode: record.exitCode,
    durationMs: record.durationMs,
    error: record.error,
    output: record.output,
  };
}
