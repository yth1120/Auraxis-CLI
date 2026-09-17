import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LspManager } from '../lsp.js';

const spawnMock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock.spawn }));

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: (data: string) => void };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: () => {} };
  child.kill = vi.fn();
  return child;
}

function frame(id: number, result: unknown = {}): Buffer {
  const body = JSON.stringify({ jsonrpc: '2.0', id, result });
  return Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function frameError(id: number, message: string): Buffer {
  const body = JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message } });
  return Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function notificationFrame(method: string, params: unknown): Buffer {
  const body = JSON.stringify({ jsonrpc: '2.0', method, params });
  return Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function parseFrame(data: string): { id?: number; method?: string } {
  const bodyStart = data.indexOf('\r\n\r\n') + 4;
  return data.startsWith('Content-Length:') ? JSON.parse(data.slice(bodyStart)) : JSON.parse(data);
}

beforeEach(() => {
  spawnMock.spawn.mockReset();
});

afterEach(() => {
  delete process.env.AURAXIS_LSP_COMMAND;
  delete process.env.AURAXIS_LSP_ARGS;
  delete process.env.AURAXIS_LSP_INIT_OPTIONS;
});

describe('LSP manager runtime', () => {
  it('starts a server, sends requests and closes cleanly', async () => {
    const writes: string[] = [];
    spawnMock.spawn.mockImplementation(() => {
      const child = fakeChild();
      child.stdin.write = (data: string) => {
        writes.push(data);
        const message = parseFrame(data);
        if (message.id && message.method === 'initialize') {
          queueMicrotask(() => child.stdout.emit('data', frame(message.id!)));
        } else if (message.id && message.method === 'textDocument/definition') {
          queueMicrotask(() => child.stdout.emit('data', frame(message.id!, { uri: 'file:///a.ts' })));
        } else if (message.id && message.method === 'textDocument/references') {
          queueMicrotask(() => child.stdout.emit('data', frame(message.id!, [{ uri: 'file:///a.ts' }])));
        }
      };
      return child;
    });
    process.env.AURAXIS_LSP_COMMAND = 'fake-lsp';
    process.env.AURAXIS_LSP_ARGS = '["--stdio"]';
    process.env.AURAXIS_LSP_INIT_OPTIONS = '{"tsserver":{"path":"/tmp/tsserver.js"}}';
    const manager = await LspManager.fromEnv(process.cwd());
    expect(manager).not.toBeNull();
    expect(writes.join('')).toContain('"initializationOptions"');
    expect(writes.join('')).toContain('/tmp/tsserver.js');
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-lsp-file-')), 'a.ts');
    await fs.writeFile(file, 'export const a = 1;', 'utf8');
    expect(await manager!.definition(file, 1, 1)).toMatchObject({ uri: 'file:///a.ts' });
    expect(await manager!.references(file, 1, 1)).toHaveLength(1);
    await manager!.close();
    expect(spawnMock.spawn).toHaveBeenCalledWith('fake-lsp', ['--stdio'], expect.any(Object));
  });

  it('falls back to null when the server fails to start', async () => {
    spawnMock.spawn.mockImplementation(() => {
      const child = fakeChild();
      queueMicrotask(() => child.emit('error', new Error('spawn failed')));
      return child;
    });
    process.env.AURAXIS_LSP_COMMAND = 'missing-lsp';
    expect(await LspManager.fromEnv(process.cwd())).toBeNull();
  });

  it('rejects LSP RPC errors', async () => {
    spawnMock.spawn.mockImplementation(() => {
      const child = fakeChild();
      child.stdin.write = (data: string) => {
        const message = parseFrame(data);
        if (message.id && message.method === 'initialize') {
          queueMicrotask(() => child.stdout.emit('data', frame(message.id!)));
        } else if (message.id && message.method === 'textDocument/definition') {
          queueMicrotask(() => child.stdout.emit('data', frameError(message.id!, 'not found')));
        }
      };
      return child;
    });
    process.env.AURAXIS_LSP_COMMAND = 'fake-lsp';
    const manager = await LspManager.fromEnv(process.cwd());
    expect(manager).not.toBeNull();
    await expect(manager!.definition('/tmp/a.ts', 1, 1)).rejects.toThrow('not found');
    await manager!.close();
  });

  it('parses UTF-8 frames when notifications contain non-ASCII text', async () => {
    spawnMock.spawn.mockImplementation(() => {
      const child = fakeChild();
      child.stdin.write = (data: string) => {
        const message = parseFrame(data);
        if (message.id && message.method === 'initialize') {
          queueMicrotask(() => {
            child.stdout.emit(
              'data',
              notificationFrame('window/logMessage', {
                message: `当前项目路径包含中文：${'测试目录/'.repeat(40)}`,
              }),
            );
            child.stdout.emit('data', frame(message.id!));
          });
        }
      };
      return child;
    });
    process.env.AURAXIS_LSP_COMMAND = 'fake-lsp';
    const manager = await LspManager.fromEnv(process.cwd());
    expect(manager).not.toBeNull();
    await manager!.close();
  });

  it('handles frames without content-length and stdin write failures', async () => {
    vi.useFakeTimers();
    try {
      spawnMock.spawn.mockImplementation(() => {
        const child = fakeChild();
        child.stdin.write = () => {};
        queueMicrotask(() => child.stdout.emit('data', Buffer.from('no-header\r\n\r\n')));
        return child;
      });
      process.env.AURAXIS_LSP_COMMAND = 'fake-lsp';
      const pending = LspManager.fromEnv(process.cwd());
      await vi.advanceTimersByTimeAsync(16_000);
      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns null when writing to the LSP stdin fails', async () => {
    spawnMock.spawn.mockImplementation(() => {
      const child = fakeChild();
      child.stdin.write = () => {
        throw new Error('stdin closed');
      };
      return child;
    });
    process.env.AURAXIS_LSP_COMMAND = 'fake-lsp';
    expect(await LspManager.fromEnv(process.cwd())).toBeNull();
  });

  it('ignores malformed LSP args and rejects when the server closes early', async () => {
    spawnMock.spawn.mockImplementation(() => {
      const child = fakeChild();
      child.stdin.write = (data: string) => {
        const message = parseFrame(data);
        if (message.id && message.method === 'initialize') {
          queueMicrotask(() => child.stdout.emit('data', frame(message.id!)));
        }
      };
      return child;
    });
    process.env.AURAXIS_LSP_COMMAND = 'fake-lsp';
    process.env.AURAXIS_LSP_ARGS = '{bad';
    const manager = await LspManager.fromEnv(process.cwd());
    expect(manager).not.toBeNull();
    await manager!.close();

    spawnMock.spawn.mockImplementation(() => {
      const child = fakeChild();
      queueMicrotask(() => child.emit('close'));
      return child;
    });
    delete process.env.AURAXIS_LSP_ARGS;
    expect(await LspManager.fromEnv(process.cwd())).toBeNull();
  });
});
