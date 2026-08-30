import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCheckpoint,
  createWorktree,
  listCheckpoints,
  listWorktrees,
  removeWorktree,
  restoreCheckpoint,
} from '../worktree.js';

const exec = promisify(execFile);
let home = '';
let repo = '';

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-worktree-home-'));
  process.env.AURAXIS_HOME = home;
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-worktree-repo-'));
  await exec('git', ['init', '-q'], { cwd: repo });
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: repo });
  await fs.writeFile(path.join(repo, 'a.txt'), 'v1\n', 'utf8');
  await exec('git', ['add', '-A'], { cwd: repo });
  await exec('git', ['commit', '-m', 'init'], { cwd: repo });
});

afterEach(async () => {
  delete process.env.AURAXIS_HOME;
});

describe('worktree and checkpoint', () => {
  it('creates, lists and removes an isolated worktree', async () => {
    expect(await listWorktrees(repo)).toHaveLength(0);
    const worktree = await createWorktree(repo, 'HEAD');
    const list = await listWorktrees(repo);
    expect(list).toHaveLength(1);
    expect((await fs.readFile(path.join(worktree.path, 'a.txt'), 'utf8')).trim()).toBe('v1');
    await removeWorktree(repo, worktree.id);
    expect(await listWorktrees(repo)).toHaveLength(0);
  });

  it('creates, lists and restores a checkpoint', async () => {
    expect(await listCheckpoints(repo)).toHaveLength(0);
    await fs.writeFile(path.join(repo, 'a.txt'), 'v2\n', 'utf8');
    const checkpoint = await createCheckpoint(repo, 'before-change');
    expect((await listCheckpoints(repo))[0].name).toBe('before-change');
    await fs.writeFile(path.join(repo, 'a.txt'), 'v3\n', 'utf8');
    await restoreCheckpoint(repo, checkpoint.id);
    expect((await fs.readFile(path.join(repo, 'a.txt'), 'utf8')).trim()).toBe('v2');
  });

  it('rejects unknown worktree/checkpoint and supports no-op restore', async () => {
    await expect(removeWorktree(repo, 'missing')).rejects.toThrow(/未知 worktree/);
    await expect(restoreCheckpoint(repo, 'missing')).rejects.toThrow(/未知 checkpoint/);
    const checkpoint = await createCheckpoint(repo, 'no-change');
    await restoreCheckpoint(repo, checkpoint.id);
  });

  it('initializes a missing git repository and reports missing HEAD', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-worktree-no-git-'));
    await expect(createWorktree(dir)).rejects.toThrow(/HEAD|fatal/);
  });
});
