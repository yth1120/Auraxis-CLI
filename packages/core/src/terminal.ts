import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { safeProcessEnv } from './safe-env.js';

export interface PtySessionLike {
  write(data: string): void;
  kill(signal?: string): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: () => void): void;
}

export type PtyFactory = (opts: {
  command: string;
  cwd?: string;
  cols?: number;
  rows?: number;
}) => PtySessionLike | null;

const MAX_SCROLLBACK = 1_000_000;
const DEFAULT_TIMEOUT = 30_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.ComSpec || 'cmd.exe';
  return process.env.SHELL || '/bin/bash';
}

export const defaultPtyFactory: PtyFactory = (opts) => {
  const child: ChildProcessWithoutNullStreams = spawn(opts.command || defaultShell(), [], {
    cwd: opts.cwd || process.cwd(),
    env: safeProcessEnv({ TERM: 'xterm-256color' }),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const emitter = new EventEmitter();
  child.on('error', () => emitter.emit('exit'));
  child.stdin?.on('error', () => {});
  child.stdout?.on('data', (d: Buffer) => emitter.emit('data', d.toString()));
  child.stderr?.on('data', (d: Buffer) => emitter.emit('data', d.toString()));
  child.on('exit', () => emitter.emit('exit'));
  return {
    write: (data) => {
      try {
        child.stdin?.write(data);
      } catch {
        /* closed */
      }
    },
    kill: (signal = 'SIGTERM') => {
      try {
        child.kill(signal as NodeJS.Signals);
      } catch {
        /* gone */
      }
    },
    onData: (cb) => emitter.on('data', cb),
    onExit: (cb) => emitter.on('exit', cb),
  };
};

interface InternalSession {
  backend: PtySessionLike;
  id: string;
  owner: string;
  command: string;
  createdAt: number;
  buffer: string;
  lastRead: number;
  exited: boolean;
}

export class PtyRegistry {
  private sessions = new Map<string, InternalSession>();

  constructor(private factory: PtyFactory = defaultPtyFactory) {}

  create(opts: { owner: string; id?: string; command?: string; cwd?: string }): { id: string; command: string } {
    const command = opts.command?.trim() || defaultShell();
    const id = opts.id || `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (this.sessions.has(id)) throw new Error(`PTY 会话 ${id} 已存在`);
    const backend = this.factory({ command, cwd: opts.cwd });
    if (!backend) throw new Error('PTY 不可用');
    const session: InternalSession = {
      backend,
      id,
      owner: opts.owner,
      command,
      createdAt: Date.now(),
      buffer: '',
      lastRead: 0,
      exited: false,
    };
    backend.onData((data) => {
      session.buffer += data;
      if (session.buffer.length > MAX_SCROLLBACK) {
        const dropped = session.buffer.length - MAX_SCROLLBACK;
        session.buffer = session.buffer.slice(dropped);
        session.lastRead = Math.max(0, session.lastRead - dropped);
      }
    });
    backend.onExit(() => {
      session.exited = true;
      if (this.sessions.get(id) === session) this.sessions.delete(id);
    });
    this.sessions.set(id, session);
    return { id, command };
  }

  private get(id: string, owner: string): InternalSession | null {
    const session = this.sessions.get(id);
    return session && session.owner === owner ? session : null;
  }

  list(owner: string): Array<{ id: string; command: string; createdAt: number }> {
    return [...this.sessions.values()]
      .filter((session) => session.owner === owner)
      .map((session) => ({ id: session.id, command: session.command, createdAt: session.createdAt }));
  }

  read(id: string, owner: string, timeoutMs: number): Promise<{ output: string } | null> {
    const session = this.get(id, owner);
    if (!session) return Promise.resolve(null);
    const deadline = Date.now() + Math.max(0, Math.min(timeoutMs, DEFAULT_TIMEOUT));
    const loop = async (): Promise<{ output: string } | null> => {
      while (session.buffer.length === session.lastRead && !session.exited && Date.now() < deadline) {
        await sleep(50);
      }
      const output = session.buffer.slice(session.lastRead);
      session.lastRead = session.buffer.length;
      return { output };
    };
    return loop();
  }

  write(id: string, owner: string, data: string, enter: boolean): boolean {
    const session = this.get(id, owner);
    if (!session) return false;
    session.backend.write(data + (enter ? '\r' : ''));
    return true;
  }

  signal(id: string, owner: string, signal: string): boolean {
    const session = this.get(id, owner);
    if (!session) return false;
    if (signal === 'SIGINT') session.backend.write('\x03');
    else if (signal === 'SIGTSTP') session.backend.write('\x1a');
    else if (signal === 'SIGQUIT') session.backend.write('\x1c');
    else session.backend.kill(signal || 'SIGTERM');
    return true;
  }

  close(id: string, owner: string): boolean {
    const session = this.get(id, owner);
    if (!session) return false;
    session.backend.kill('SIGKILL');
    this.sessions.delete(id);
    return true;
  }

  clearOwner(owner: string): number {
    let count = 0;
    for (const session of [...this.sessions.values()]) {
      if (session.owner === owner) {
        session.backend.kill('SIGKILL');
        this.sessions.delete(session.id);
        count += 1;
      }
    }
    return count;
  }
}

export const ptyRegistry = new PtyRegistry();

export async function runPtyAction(
  action: string,
  input: Record<string, unknown>,
  owner: string,
  registry: PtyRegistry = ptyRegistry,
): Promise<{ output: unknown; error?: string }> {
  const id = typeof input.session_id === 'string' ? input.session_id : '';
  switch (action) {
    case 'create':
      try {
        return {
          output: registry.create({
            owner,
            id: id || undefined,
            command: typeof input.command === 'string' ? input.command : undefined,
            cwd: typeof input.cwd === 'string' ? input.cwd : undefined,
          }),
        };
      } catch (error) {
        return { output: null, error: error instanceof Error ? error.message : String(error) };
      }
    case 'write': {
      const data = typeof input.data === 'string' ? input.data : '';
      if (!id || !data) return { output: null, error: 'session_id 与 data 必填' };
      return registry.write(id, owner, data, input.enter === true)
        ? { output: { ok: true } }
        : { output: null, error: 'PTY 会话不存在或不属于当前任务' };
    }
    case 'read': {
      if (!id) return { output: null, error: 'session_id 必填' };
      const timeoutMs = typeof input.timeout_ms === 'number' ? input.timeout_ms : 2000;
      const result = await registry.read(id, owner, timeoutMs);
      return result ? { output: result } : { output: null, error: 'PTY 会话不存在或不属于当前任务' };
    }
    case 'close': {
      if (!id) return { output: null, error: 'session_id 必填' };
      return registry.close(id, owner)
        ? { output: { ok: true } }
        : { output: null, error: 'PTY 会话不存在或不属于当前任务' };
    }
    case 'signal': {
      if (!id) return { output: null, error: 'session_id 必填' };
      const signal = typeof input.signal === 'string' ? input.signal : 'SIGTERM';
      return registry.signal(id, owner, signal)
        ? { output: { ok: true } }
        : { output: null, error: 'PTY 会话不存在或不属于当前任务' };
    }
    case 'list':
      return { output: { sessions: registry.list(owner) } };
    case 'clear':
      return { output: { closed: registry.clearOwner(owner) } };
    default:
      return { output: null, error: `未知 PTY 动作: ${action}` };
  }
}

export async function runTerminalAction(
  action: string,
  input: Record<string, unknown>,
  owner: string,
  registry: PtyRegistry = ptyRegistry,
): Promise<{ output: unknown; error?: string }> {
  const mapped: Record<string, string> = {
    open: 'create',
    list: 'list',
    read: 'read',
    send: 'write',
    signal: 'signal',
    close: 'close',
  };
  return runPtyAction(mapped[action] || action, input, owner, registry);
}
