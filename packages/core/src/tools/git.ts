import { spawn } from 'node:child_process';
import type { JsonObject } from '../types.js';
import type { ToolContext, ToolOutput } from './registry.js';

async function runGit(args: string[], cwd: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
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
        reject(new Error(`git 命令超时（${timeoutMs}ms）`));
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
      if (done) return;
      done = true;
      if (code !== 0) reject(new Error(stderr || `git 退出码 ${code}`));
      else resolve(stdout);
    });
  });
}

export async function gitStatusTool(_input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  return { content: await runGit(['status', '--short', '--branch'], ctx.projectRoot) || '工作区干净' };
}

export async function gitDiffTool(_input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const output = await runGit(['diff', '--stat'], ctx.projectRoot);
  return { content: output || '无未提交差异' };
}

export async function gitLogTool(_input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  return { content: await runGit(['log', '--oneline', '-20'], ctx.projectRoot) || '暂无提交' };
}

export async function gitCommitTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const message = typeof input.message === 'string' && input.message.trim() ? input.message.trim() : 'Auraxis CLI commit';
  await runGit(['add', '-A'], ctx.projectRoot);
  const output = await runGit(['commit', '-m', message], ctx.projectRoot);
  return { content: output };
}

