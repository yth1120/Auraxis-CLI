import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getAppPaths } from './config.js';
import { safeProcessEnv } from './safe-env.js';
import { parseJson } from './validation.js';

export interface WorktreeInfo {
  id: string;
  projectRoot: string;
  path: string;
  branch: string;
  createdAt: number;
}

export interface CheckpointInfo {
  id: string;
  projectRoot: string;
  name: string;
  patchFile: string;
  createdAt: number;
}

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

async function ensureGitRepo(root: string): Promise<void> {
  try {
    await runGit(['rev-parse', '--is-inside-work-tree'], root, 5000);
  } catch {
    await runGit(['init'], root, 10000);
  }
  await runGit(['rev-parse', '--verify', 'HEAD'], root, 5000);
}

function projectKey(root: string): string {
  return Buffer.from(path.resolve(root)).toString('base64url');
}

async function readJsonl(file: string): Promise<unknown[]> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return raw.split(/\r?\n/).filter(Boolean).map((line) => parseJson(line)).filter((value) => value !== undefined);
  } catch {
    return [];
  }
}

async function writeJsonl(file: string, records: unknown[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

export async function createWorktree(projectRoot: string, branch?: string): Promise<WorktreeInfo> {
  await ensureGitRepo(projectRoot);
  const start = branch?.trim() || 'HEAD';
  const id = `wt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const worktreeRoot = path.join(getAppPaths().home, 'worktrees', projectKey(projectRoot));
  const worktreePath = path.join(worktreeRoot, id);
  await runGit(['worktree', 'add', '--detach', worktreePath, start], projectRoot);
  const info: WorktreeInfo = {
    id,
    projectRoot: path.resolve(projectRoot),
    path: worktreePath,
    branch: branch?.trim() || 'HEAD',
    createdAt: Date.now(),
  };
  const file = path.join(getAppPaths().home, 'worktrees', `${projectKey(projectRoot)}.jsonl`);
  const records = await readJsonl(file);
  records.push(info);
  await writeJsonl(file, records);
  return info;
}

export async function listWorktrees(projectRoot: string): Promise<WorktreeInfo[]> {
  const file = path.join(getAppPaths().home, 'worktrees', `${projectKey(projectRoot)}.jsonl`);
  const records = await readJsonl(file);
  return records.filter((item): item is WorktreeInfo => Boolean(item && typeof item === 'object' && (item as WorktreeInfo).id && (item as WorktreeInfo).path));
}

export async function removeWorktree(projectRoot: string, id: string): Promise<void> {
  const info = (await listWorktrees(projectRoot)).find((item) => item.id === id);
  if (!info) throw new Error(`未知 worktree: ${id}`);
  await runGit(['worktree', 'remove', '--force', info.path], projectRoot);
  const file = path.join(getAppPaths().home, 'worktrees', `${projectKey(projectRoot)}.jsonl`);
  const records = (await readJsonl(file)).filter((item) => (item as WorktreeInfo)?.id !== id);
  await writeJsonl(file, records);
}

export async function createCheckpoint(projectRoot: string, name: string): Promise<CheckpointInfo> {
  await ensureGitRepo(projectRoot);
  const id = `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const base = path.join(getAppPaths().home, 'checkpoints', projectKey(projectRoot));
  const patchFile = path.join(base, `${id}.patch`);
  const patch = await runGit(['diff', '--binary', '--no-ext-diff'], projectRoot);
  const staged = await runGit(['diff', '--binary', '--cached', '--no-ext-diff'], projectRoot);
  const combined = [staged, patch].filter(Boolean).join('\n');
  await fs.mkdir(path.dirname(patchFile), { recursive: true });
  await fs.writeFile(patchFile, combined || '# no changes\n', 'utf8');
  const info: CheckpointInfo = {
    id,
    projectRoot: path.resolve(projectRoot),
    name: name?.trim() || 'checkpoint',
    patchFile,
    createdAt: Date.now(),
  };
  const file = path.join(getAppPaths().home, 'checkpoints', `${projectKey(projectRoot)}.jsonl`);
  const records = await readJsonl(file);
  records.push(info);
  await writeJsonl(file, records);
  return info;
}

export async function listCheckpoints(projectRoot: string): Promise<CheckpointInfo[]> {
  const file = path.join(getAppPaths().home, 'checkpoints', `${projectKey(projectRoot)}.jsonl`);
  const records = await readJsonl(file);
  return records.filter((item): item is CheckpointInfo => Boolean(item && typeof item === 'object' && (item as CheckpointInfo).id && (item as CheckpointInfo).patchFile));
}

export async function restoreCheckpoint(projectRoot: string, id: string): Promise<void> {
  const info = (await listCheckpoints(projectRoot)).find((item) => item.id === id);
  if (!info) throw new Error(`未知 checkpoint: ${id}`);
  const content = await fs.readFile(info.patchFile, 'utf8');
  if (!content || content === '# no changes\n') return;
  const status = await runGit(['status', '--porcelain'], projectRoot);
  let stashed = false;
  if (status.trim()) {
    await runGit(['stash', 'push', '--include-untracked', '-m', `auraxis-checkpoint-${id}`], projectRoot);
    stashed = true;
  }
  try {
    await runGit(['apply', '--3way', info.patchFile], projectRoot);
    if (stashed) {
      await runGit(['stash', 'drop'], projectRoot);
      stashed = false;
    }
  } catch (error) {
    if (stashed) {
      await runGit(['stash', 'pop'], projectRoot).catch(() => {});
    }
    throw error;
  }
}
