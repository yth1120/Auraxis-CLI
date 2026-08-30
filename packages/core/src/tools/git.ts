import { spawn } from 'node:child_process';
import { safeProcessEnv } from '../safe-env.js';
import type { JsonObject } from '../types.js';
import type { ToolContext, ToolOutput } from './registry.js';
import { asJsonObject } from '../validation.js';

async function runGit(args: string[], cwd: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      env: safeProcessEnv(),
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

async function currentGitBranch(cwd: string): Promise<string> {
  return (await runGit(['branch', '--show-current'], cwd)).trim() || 'main';
}

function githubRepository(remote: string): { owner: string; repo: string } {
  const match = /(?:github\.com[/:]([^/]+)\/([^/]+?))(?:\.git)?(?:\/|$)/.exec(remote);
  if (!match) throw new Error(`无法从远程地址识别 GitHub 仓库: ${remote}`);
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

export async function gitCreatePullRequestTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : '';
  const base = typeof input.base === 'string' && input.base.trim() ? input.base.trim() : 'main';
  const head = typeof input.head === 'string' && input.head.trim() ? input.head.trim() : await currentGitBranch(ctx.projectRoot);
  const body = typeof input.body === 'string' ? input.body : '';
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  if (!title || !token) throw new Error('创建 PR 需要 title 和 GITHUB_TOKEN（或 GH_TOKEN）');
  const remote = (await runGit(['remote', 'get-url', 'origin'], ctx.projectRoot)).trim();
  await runGit(['push', '-u', 'origin', head], ctx.projectRoot);
  const { owner, repo } = githubRepository(remote);
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({ title, head, base, body }),
  });
  const json = asJsonObject(await response.json().catch(() => ({})));
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${json.message || '创建 PR 失败'}`);
  return { content: `已创建 Pull Request: ${json.html_url || ''}` };
}
