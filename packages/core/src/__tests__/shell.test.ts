import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { bashTool, pwshTool } from '../tools/shell.js';
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

function context(signal?: AbortSignal): ToolContext {
  return {
    projectRoot: process.cwd(),
    emit: () => {},
    todos: [],
    setTodos: () => {},
    signal,
  };
}

beforeEach(() => {
  spawnMock.spawn.mockReset();
  spawnMock.spawn.mockImplementation(() => fakeChild());
  delete process.env.DEEPSEEK_API_KEY;
});

describe('shell tool', () => {
  it('rejects a bare interactive shell command instead of hanging', async () => {
    await expect(bashTool({ command: 'cd test; bash' }, context())).rejects.toThrow('禁止直接启动交互式 shell');
  });

  it('does not pass API keys or tokens to child processes', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-secret';
    process.env.MY_APP_TOKEN = 'tok-secret';
    const pending = bashTool({ command: 'env' }, context());
    await vi.waitFor(() => expect(spawnMock.spawn).toHaveBeenCalled());
    const callArgs = spawnMock.spawn.mock.calls[0];
    const options = (callArgs[1] ?? callArgs[2]) as { env?: Record<string, string | undefined> };
    const env = options.env ?? {};
    expect(env.DEEPSEEK_API_KEY).toBeUndefined();
    expect(env.MY_APP_TOKEN).toBeUndefined();
    expect(typeof env.PATH).toBe('string');
    const child = spawnMock.spawn.mock.results[0]?.value as ReturnType<typeof fakeChild>;
    child.emit('close', 0);
    await pending;
  });

  it('kills the child and rejects when the command times out', async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      spawnMock.spawn.mockReturnValue(child as never);
      const pending = bashTool({ command: 'sleep 100', timeout_ms: 100 }, context());
      const expectation = expect(pending).rejects.toThrow('命令超时');
      await vi.advanceTimersByTimeAsync(150);
      expect(child.kill).toHaveBeenCalled();
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts the child when the tool signal fires', async () => {
    const controller = new AbortController();
    const child = fakeChild();
    spawnMock.spawn.mockReturnValue(child as never);
    const pending = bashTool({ command: 'sleep 100' }, context(controller.signal));
    await vi.waitFor(() => expect(spawnMock.spawn).toHaveBeenCalled());
    controller.abort();
    expect(child.kill).toHaveBeenCalled();
    child.emit('close', 0);
    await pending;
  });
});

describe('pwsh tool', () => {
  it('caps oversized stdout instead of growing memory without bound', async () => {
    const child = fakeChild();
    spawnMock.spawn.mockReturnValue(child as never);
    const pending = pwshTool({ command: 'Write-Output hi' }, context());
    child.stdout.emit('data', Buffer.from('x'.repeat(2_000_000)));
    child.emit('close', 0);
    const output = await pending;
    expect(output.content.length).toBeLessThanOrEqual(1_000_000 + 32);
  });

  it('kills the child and rejects when PowerShell times out', async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      spawnMock.spawn.mockReturnValue(child as never);
      const pending = pwshTool({ command: 'Start-Sleep 100', timeout_ms: 100 }, context());
      const expectation = expect(pending).rejects.toThrow('PowerShell 命令超时');
      await vi.advanceTimersByTimeAsync(150);
      expect(child.kill).toHaveBeenCalled();
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
