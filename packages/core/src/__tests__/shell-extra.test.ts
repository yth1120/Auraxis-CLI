import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

function context(sandbox?: unknown): ToolContext {
  return { projectRoot: '/project', emit: () => {}, todos: [], setTodos: () => {}, sandbox: sandbox as never };
}

beforeEach(() => {
  spawnMock.spawn.mockReset();
  spawnMock.spawn.mockReturnValue(fakeChild() as never);
});

describe('shell edge cases', () => {
  it('blocks commands in read sandbox and non-zero exits', async () => {
    await expect(bashTool({ command: 'echo hi' }, context({ mode: 'read', assertCommand: () => { throw new Error('只读沙箱禁止执行命令'); } }))).rejects.toThrow('只读');
    const child = fakeChild();
    spawnMock.spawn.mockReturnValue(child as never);
    const pending = bashTool({ command: 'echo hi' }, context());
    child.emit('close', 1);
    await expect(pending).rejects.toThrow('命令退出码 1');
  });

  it('does not allow interactive shell startup', async () => {
    await expect(bashTool({ command: 'bash' }, context())).rejects.toThrow('交互式');
    await expect(pwshTool({ command: 'powershell' }, context())).rejects.toThrow('交互式');
  });

  it('rejects pwsh inside container sandbox and resolves stderr-exit', async () => {
    await expect(pwshTool({ command: 'Write-Output hi' }, context({ mode: 'container', assertCommand: () => {} }))).rejects.toThrow('container');
    const child = fakeChild();
    spawnMock.spawn.mockReturnValue(child as never);
    const pending = pwshTool({ command: 'Write-Output hi' }, context());
    child.stderr.emit('data', Buffer.from('some error'));
    child.emit('close', 1);
    expect((await pending).content).toContain('some error');
  });

  it('surfaces child spawn errors and respects timeout for both shells', async () => {
    const child = fakeChild();
    spawnMock.spawn.mockReturnValue(child as never);
    const pending = bashTool({ command: 'echo hi', timeout_ms: 50 }, context());
    child.emit('error', new Error('spawn boom'));
    await expect(pending).rejects.toThrow('spawn boom');

    const pwshChild = fakeChild();
    spawnMock.spawn.mockReturnValue(pwshChild as never);
    const pendingPwsh = pwshTool({ command: 'Write-Output hi', timeout_ms: 50 }, context());
    pwshChild.emit('error', new Error('pwsh boom'));
    await expect(pendingPwsh).rejects.toThrow('pwsh boom');
  });

  it('runs on non-Windows shells and caps stderr', async () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const child = fakeChild();
      spawnMock.spawn.mockReturnValue(child as never);
      const pending = bashTool({ command: 'echo hi' }, context());
      child.stderr.emit('data', Buffer.from('x'.repeat(600_000)));
      child.emit('close', 0);
      const result = await pending;
      expect(result.content.length).toBeLessThanOrEqual(500_000 + 32);
    } finally {
      Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
  });

  it('uses ComSpec on Windows when available', async () => {
    const originalShell = process.env.AURAXIS_SHELL;
    const originalComSpec = process.env.ComSpec;
    delete process.env.AURAXIS_SHELL;
    process.env.ComSpec = String.raw`C:\custom\cmd.exe`;
    try {
      const child = fakeChild();
      spawnMock.spawn.mockReturnValue(child as never);
      const pending = bashTool({ command: 'echo hi' }, context());
      await vi.waitFor(() => expect(spawnMock.spawn).toHaveBeenCalled());
      expect(spawnMock.spawn.mock.calls[0][0]).toBe('echo hi');
      child.emit('close', 0);
      await pending;
    } finally {
      if (originalShell === undefined) delete process.env.AURAXIS_SHELL;
      else process.env.AURAXIS_SHELL = originalShell;
      if (originalComSpec === undefined) delete process.env.ComSpec;
      else process.env.ComSpec = originalComSpec;
    }
  });
});
