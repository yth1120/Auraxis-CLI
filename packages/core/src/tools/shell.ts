import { spawn } from 'node:child_process';
import type { JsonObject } from '../types.js';
import type { ToolContext, ToolOutput } from './registry.js';

function resolveShell(): [string, string[]] {
  if (process.env.AURAXIS_SHELL) {
    return [process.env.AURAXIS_SHELL, ['-c']];
  }
  if (process.platform === 'win32') {
    return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c']];
  }
  return [process.env.SHELL || '/bin/sh', ['-c']];
}

async function runProcess(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const [shell, prefix] = resolveShell();
    const child = spawn(shell, [...prefix, command], {
      cwd,
      windowsHide: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(stdout + (stderr ? `\n[stderr]\n${stderr}` : ''));
    };
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 1_000_000) stdout = stdout.slice(0, 1_000_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 500_000) stderr = stderr.slice(0, 500_000);
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code !== 0 && !stderr) {
        finish(new Error(`命令退出码 ${code}`));
      } else {
        finish();
      }
    });
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`命令超时（${timeoutMs}ms）`));
    }, timeoutMs);
  });
}

async function runShellTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const command = typeof input.command === 'string' ? input.command : '';
  if (!command) throw new Error('command 不能为空');
  const timeoutMs = typeof input.timeout_ms === 'number' ? Math.min(10 * 60_000, Math.max(100, input.timeout_ms)) : 120_000;
  const output = await runProcess(command, ctx.projectRoot, timeoutMs, ctx.signal);
  return { content: output || '(无输出)' };
}

async function runPwshTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const command = typeof input.command === 'string' ? input.command : '';
  if (!command) throw new Error('command 不能为空');
  const timeoutMs = typeof input.timeout_ms === 'number' ? Math.min(10 * 60_000, Math.max(100, input.timeout_ms)) : 120_000;
  const executable = process.env.AURAXIS_PWSH || (process.platform === 'win32' ? 'powershell.exe' : 'pwsh');
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd: ctx.projectRoot,
      windowsHide: true,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      if (!done) {
        done = true;
        reject(new Error(`PowerShell 命令超时（${timeoutMs}ms）`));
      }
    }, timeoutMs);
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', (error) => {
      clearTimeout(timer);
      if (!done) {
        done = true;
        reject(error);
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!done) {
        done = true;
        if (code !== 0 && !stderr) reject(new Error(`PowerShell 命令退出码 ${code}`));
        else resolve(stdout + (stderr ? `\n[stderr]\n${stderr}` : ''));
      }
    });
    ctx.signal?.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
  });
  return { content: output || '(无输出)' };
}

export const bashTool = runShellTool;
export const pwshTool = runPwshTool;
