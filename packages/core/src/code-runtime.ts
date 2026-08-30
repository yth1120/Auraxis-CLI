import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { safeProcessEnv, unsafeCodeEnabled, unsafeCodeDisabledMessage } from './safe-env.js';

export type CodeLanguage = 'javascript' | 'python' | 'shell';

export interface RunCodeRequest {
  language: CodeLanguage | 'typescript';
  code: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  signal?: AbortSignal;
}

export interface RunCodeResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

const OUTPUT_CAP = 50_000;
const DEFAULT_TIMEOUT = 30_000;

function languageBinary(language: CodeLanguage): { bin: string; file: string; args?: string[] } {
  switch (language) {
    case 'python':
      return {
        bin: process.env.AURAXIS_PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3'),
        file: 'main.py',
      };
    case 'shell':
      return process.platform === 'win32'
        ? { bin: process.env.ComSpec || 'cmd.exe', file: 'run.cmd', args: ['/d', '/s', '/c'] }
        : { bin: process.env.SHELL || 'bash', file: 'run.sh' };
    default:
      return { bin: process.execPath, file: 'main.js' };
  }
}

async function runChild(
  bin: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
  extraEnv: Record<string, string> = {},
): Promise<Omit<RunCodeResult, 'truncated'> & { truncated: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd,
      windowsHide: true,
      env: safeProcessEnv(extraEnv),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ stdout, stderr, exitCode, timedOut, truncated });
    };
    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      if (stdout.length >= OUTPUT_CAP) {
        truncated = true;
        return;
      }
      stdout += text.slice(0, OUTPUT_CAP - stdout.length);
      if (text.length > OUTPUT_CAP - stdout.length) truncated = true;
    });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      if (stderr.length >= OUTPUT_CAP) {
        truncated = true;
        return;
      }
      stderr += text.slice(0, OUTPUT_CAP - stderr.length);
      if (text.length > OUTPUT_CAP - stderr.length) truncated = true;
    });
    const onAbort = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* gone */
      }
      finish(null);
    };
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* gone */
      }
      finish(null);
    }, timeoutMs);
  });
}

export async function runCode(req: RunCodeRequest): Promise<RunCodeResult> {
  if (!unsafeCodeEnabled()) {
    return { stdout: '', stderr: unsafeCodeDisabledMessage('RunCode'), exitCode: 1, timedOut: false, truncated: false };
  }
  const body = typeof req.code === 'string' ? req.code.trim() : '';
  if (!body) return { stdout: '', stderr: 'RunCode 代码不能为空', exitCode: 1, timedOut: false, truncated: false };
  const language = req.language === 'typescript' ? 'javascript' : req.language;
  const { bin, file, args = [] } = languageBinary(language);
  const timeoutMs = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : DEFAULT_TIMEOUT;
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'auraxis-code-'));
  try {
    await fsp.writeFile(path.join(dir, file), body, 'utf8');
    return await runChild(bin, [...args, file], dir, timeoutMs, req.signal, req.env || {});
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
