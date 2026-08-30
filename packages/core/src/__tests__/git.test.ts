import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  gitCommitTool,
  gitCreatePullRequestTool,
  gitDiffTool,
  gitLogTool,
  gitStatusTool,
} from '../tools/git.js';
import type { ToolContext } from '../tools/registry.js';

const spawnMock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock.spawn }));

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function context(): ToolContext {
  return { projectRoot: '/project', emit: () => {}, todos: [], setTodos: () => {} };
}

beforeEach(() => {
  spawnMock.spawn.mockReset();
  spawnMock.spawn.mockImplementation(() => {
    const child = fakeChild();
    queueMicrotask(() => {
      const args = spawnMock.spawn.mock.calls.at(-1)?.[1] as string[] | undefined;
      const text = args?.[0] === 'remote'
        ? 'git@github.com:owner/repo.git\n'
        : args?.[0] === 'branch'
          ? 'feature\n'
          : 'git output\n';
      child.stdout.emit('data', Buffer.from(text));
      child.emit('close', 0);
    });
    return child;
  });
});

afterEach(() => {
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  vi.unstubAllGlobals();
});

describe('git tools', () => {
  it('reads status, diff and log', async () => {
    expect((await gitStatusTool({}, context())).content).toContain('git output');
    expect((await gitDiffTool({}, context())).content).toContain('git output');
    expect((await gitLogTool({}, context())).content).toContain('git output');
  });

  it('commits changes with a message', async () => {
    const output = await gitCommitTool({ message: 'feat: test' }, context());
    expect(output.content).toContain('git output');
    const commands = spawnMock.spawn.mock.calls.map((call) => call[1]);
    expect(commands).toContainEqual(['add', '-A']);
    expect(commands).toContainEqual(['commit', '-m', 'feat: test']);
    const defaultCommit = await gitCommitTool({}, context());
    expect(defaultCommit.content).toContain('git output');
  });

  it('creates a pull request with GitHub API', async () => {
    process.env.GITHUB_TOKEN = 'token';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ html_url: 'https://github.com/a/b/pulls/1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const output = await gitCreatePullRequestTool({ title: 'PR', base: 'main' }, context());
    expect(output.content).toContain('https://github.com/a/b/pulls/1');
  });

  it('rejects missing tokens and GitHub errors', async () => {
    await expect(gitCreatePullRequestTool({ title: 'PR' }, context())).rejects.toThrow('需要 title 和');
    process.env.GITHUB_TOKEN = 'token';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: 'bad repo' }), { status: 422 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(gitCreatePullRequestTool({ title: 'PR' }, context())).rejects.toThrow('GitHub API 422');
  });

  it('rejects when git exits non-zero', async () => {
    spawnMock.spawn.mockImplementation(() => {
      const child = fakeChild();
      queueMicrotask(() => child.emit('close', 1));
      return child;
    });
    await expect(gitStatusTool({}, context())).rejects.toThrow('git 退出码 1');
  });

  it('times out long-running git commands and rejects invalid remotes', async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      spawnMock.spawn.mockReturnValue(child as never);
      const pending = gitStatusTool({}, context());
      const expectation = expect(pending).rejects.toThrow('超时');
      await vi.advanceTimersByTimeAsync(61_000);
      expect(child.kill).toHaveBeenCalled();
      await expectation;
    } finally {
      vi.useRealTimers();
    }
    spawnMock.spawn.mockImplementation(() => {
      const child = fakeChild();
      queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from('not-a-remote\n'));
        child.emit('close', 0);
      });
      return child;
    });
    process.env.GITHUB_TOKEN = 'token';
    await expect(gitCreatePullRequestTool({ title: 'PR' }, context())).rejects.toThrow('无法从远程地址');
    delete process.env.GITHUB_TOKEN;
  });
});
