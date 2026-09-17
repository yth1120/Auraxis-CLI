import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { startBackgroundCommand } from '../tasks.js';
import { safeProcessEnv } from '../safe-env.js';
import type { JsonObject } from '../types.js';
import type { ToolContext, ToolOutput } from './registry.js';

function resolveShell(): [string, string[]] {
  if (process.env.AURAXIS_SHELL) {
    return [process.env.AURAXIS_SHELL, ['-c']];
  }
  if (process.platform === 'win32') {
    return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c']];
  }
  // 容器等最小环境里 $SHELL 常指向不存在的路径（如只有 /bin/sh 的镜像），
  // 直接 spawn 会 ENOENT，这里回退到 POSIX 保证存在的 /bin/sh。
  const configured = process.env.SHELL;
  if (configured && fileExists(configured)) return [configured, ['-c']];
  return ['/bin/sh', ['-c']];
}

function fileExists(target: string): boolean {
  try {
    fs.accessSync(target, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isInteractiveShellCommand(command: string): boolean {
  const parts = command
    .split(/\s*[|;&]\s*/)
    .map((part) => part.trim().replace(/^\s*&&\s*|\s*&&\s*$/g, ''))
    .filter(Boolean);
  return parts.some((part) => /^(bash|sh|zsh|fish|node|deno|python|python3|pwsh|powershell|cmd)$/i.test(part));
}

async function runProcess(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    // Windows 上 `cmd /c` + shell:false 会把嵌套引号命令（如
    // `node -e "console.log(42)"`）静默吞掉：输出为空、退出码 0。
    // shell:true 由 cmd 直接解析原始命令行，保留引号语义。
    const shellOverride = process.env.AURAXIS_SHELL;
    const child = !shellOverride && isWin
      ? spawn(command, {
          cwd,
          windowsHide: true,
          env: safeProcessEnv(),
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : spawn(resolveShell()[0], [...resolveShell()[1], command], {
          cwd,
          windowsHide: true,
          env: safeProcessEnv(),
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
      signal?.removeEventListener('abort', abort);
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
  if (isInteractiveShellCommand(command)) {
    throw new Error('禁止直接启动交互式 shell，请提供完整命令，例如 bash -c "echo hello"');
  }
  ctx.sandbox?.assertCommand(command);
  const timeoutMs = typeof input.timeout_ms === 'number' ? Math.min(10 * 60_000, Math.max(100, input.timeout_ms)) : 120_000;
  if (input.run_in_background === true) {
    const task = startBackgroundCommand({
      command: ctx.sandbox?.wrapCommand(command) || command,
      name: typeof input.name === 'string' ? input.name : undefined,
      cwd: ctx.projectRoot,
      timeoutMs,
    });
    return {
      content: JSON.stringify({
        task_id: task.id,
        status: task.status,
        command: task.command,
        hint: '使用 TaskOutput 或 JobOutput 读取结果，TaskStop 或 JobKill 停止任务',
      }),
    };
  }
  const output = await runProcess(ctx.sandbox?.wrapCommand(command) || command, ctx.projectRoot, timeoutMs, ctx.signal);
  return { content: output || '(无输出)' };
}

async function runPwshTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const command = typeof input.command === 'string' ? input.command : '';
  if (!command) throw new Error('command 不能为空');
  if (isInteractiveShellCommand(command)) {
    throw new Error('禁止直接启动交互式 PowerShell，请提供完整命令');
  }
  ctx.sandbox?.assertCommand(command);
  if (ctx.sandbox?.mode === 'container') {
    throw new Error('container 沙箱暂不支持 Pwsh 工具，请使用 Bash 或配置兼容 runner');
  }
  const timeoutMs = typeof input.timeout_ms === 'number' ? Math.min(10 * 60_000, Math.max(100, input.timeout_ms)) : 120_000;
  const executable = process.env.AURAXIS_PWSH || (process.platform === 'win32' ? 'powershell.exe' : 'pwsh');
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd: ctx.projectRoot,
      windowsHide: true,
      env: safeProcessEnv(),
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
      ctx.signal?.removeEventListener('abort', onAbort);
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
      if (code !== 0 && !stderr) finish(new Error(`PowerShell 命令退出码 ${code}`));
      else finish();
    });
    const onAbort = () => child.kill('SIGKILL');
    ctx.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`PowerShell 命令超时（${timeoutMs}ms）`));
    }, timeoutMs);
  });
  return { content: output || '(无输出)' };
}

export const bashTool = runShellTool;
export const pwshTool = runPwshTool;
