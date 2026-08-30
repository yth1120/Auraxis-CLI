import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpManager } from '../mcp/manager.js';

const spawnMock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock.spawn }));

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: () => void; on: () => void };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  (child.stdout as EventEmitter & { resume: () => void }).resume = () => {};
  (child.stderr as EventEmitter & { resume: () => void }).resume = () => {};
  child.stdin = { write: () => {}, on: () => {} };
  child.kill = vi.fn();
  return child;
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.DEEPSEEK_API_KEY;
});

describe('MCP timeout paths', () => {
  it('does not leak parent credentials into MCP child environment', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-parent-secret';
    const child = fakeChild();
    spawnMock.spawn.mockReturnValue(child as never);
    const manager = new McpManager([{ name: 'leak', command: 'fake' }]);
    const start = manager.start();
    queueMicrotask(() => child.emit('error', new Error('spawn failed')));
    await start;
    const env = spawnMock.spawn.mock.calls.at(-1)?.[2]?.env as Record<string, string | undefined>;
    expect(env.DEEPSEEK_API_KEY).toBeUndefined();
    await manager.close();
  });

  it('records initialization timeout and closes cleanly', async () => {
    vi.useFakeTimers();
    spawnMock.spawn.mockReturnValue(fakeChild() as never);
    const manager = new McpManager([{ name: 'slow', command: 'fake' }]);
    const start = manager.start();
    await vi.advanceTimersByTimeAsync(11_000);
    await start;
    expect(manager.errors[0]).toContain('slow');
    await manager.close();
  });

  it('rejects pending requests when the stdio child errors', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    spawnMock.spawn.mockReturnValue(child as never);
    const manager = new McpManager([{ name: 'boom', command: 'fake' }]);
    const start = manager.start();
    queueMicrotask(() => child.emit('error', new Error('spawn failed')));
    await start;
    expect(manager.errors[0]).toContain('spawn failed');
    await manager.close();
  });

  it('parses RPC errors and ignores malformed stdio lines', async () => {
    const child = fakeChild();
    spawnMock.spawn.mockReturnValue(child as never);
    const manager = new McpManager([{ name: 'bad-rpc', command: 'fake' }]);
    const start = manager.start();
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from('{bad\n'));
      child.stdout.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'rpc boom' } })}\n`));
    });
    await start;
    expect(manager.errors[0]).toContain('rpc boom');
    await manager.close();
  });

  it('rejects pending requests when the stdio child exits', async () => {
    const child = fakeChild();
    spawnMock.spawn.mockReturnValue(child as never);
    const manager = new McpManager([{ name: 'exit', command: 'fake' }]);
    const start = manager.start();
    queueMicrotask(() => child.emit('exit'));
    await start;
    expect(manager.errors[0]).toContain('exited');
    await manager.close();
  });
});
