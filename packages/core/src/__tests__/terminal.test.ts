import { describe, expect, it } from 'vitest';
import { PtyRegistry, defaultPtyFactory, runPtyAction, runTerminalAction } from '../terminal.js';

function fakeFactory() {
  let data: ((value: string) => void) | null = null;
  let exited: (() => void) | null = null;
  const session = {
    write(value: string) {
      data?.(value);
    },
    kill(_signal?: string) {
      exited?.();
    },
    onData(cb: (value: string) => void) {
      data = cb;
    },
    onExit(cb: () => void) {
      exited = cb;
    },
  };
  return { session, emit: (value: string) => data?.(value) };
}

describe('Pty registry', () => {
  it('creates, lists, reads and closes owner-scoped sessions', async () => {
    const fake = fakeFactory();
    const registry = new PtyRegistry(() => fake.session);
    const created = registry.create({ owner: 'task1', id: 'pty-1', command: 'node' });
    expect(created.id).toBe('pty-1');
    expect(registry.list('task1')).toHaveLength(1);
    expect(registry.write('pty-1', 'task1', 'echo hi', true)).toBe(true);
    fake.emit('hello');
    expect((await registry.read('pty-1', 'task1', 1))?.output).toContain('hello');
    expect(registry.close('pty-1', 'task1')).toBe(true);
    expect(registry.list('task1')).toHaveLength(0);
  });

  it('routes PTY actions through the registry', async () => {
    const fake = fakeFactory();
    const registry = new PtyRegistry(() => fake.session);
    const result = await runPtyAction('create', { session_id: 'p1' }, 'owner', registry);
    expect(result.output).toMatchObject({ id: 'p1' });
  });

  it('handles write, read, signal, clear and terminal aliases', async () => {
    const fake = fakeFactory();
    const registry = new PtyRegistry(() => fake.session);
    expect((await runPtyAction('create', { session_id: 'p1' }, 'owner', registry)).output).toMatchObject({ id: 'p1' });
    expect((await runPtyAction('write', { session_id: 'p1', data: 'echo', enter: true }, 'owner', registry)).output).toEqual({ ok: true });
    fake.emit('data');
    expect((await runPtyAction('read', { session_id: 'p1' }, 'owner', registry)).output).toMatchObject({
      output: expect.stringContaining('data'),
    });
    expect((await runPtyAction('signal', { session_id: 'p1', signal: 'SIGINT' }, 'owner', registry)).output).toEqual({ ok: true });
    expect((await runPtyAction('list', {}, 'owner', registry)).output).toMatchObject({ sessions: expect.any(Array) });
    expect((await runPtyAction('close', { session_id: 'p1' }, 'owner', registry)).output).toEqual({ ok: true });
    expect((await runTerminalAction('open', { session_id: 'p2' }, 'owner', registry)).output).toMatchObject({ id: 'p2' });
    expect((await runTerminalAction('clear', {}, 'owner', registry)).output).toEqual({ closed: 1 });
    expect(await runPtyAction('bogus', {}, 'owner', registry)).toMatchObject({ error: expect.stringContaining('未知') });
  });

  it('handles duplicate sessions and invalid inputs', async () => {
    const fake = fakeFactory();
    const registry = new PtyRegistry(() => fake.session);
    registry.create({ owner: 'owner', id: 'p1' });
    expect(() => registry.create({ owner: 'owner', id: 'p1' })).toThrow('已存在');
    expect(registry.write('missing', 'owner', 'x', false)).toBe(false);
    expect(await registry.read('missing', 'owner', 1)).toBeNull();
    expect(await runPtyAction('write', { session_id: 'p1' }, 'owner', registry)).toMatchObject({ error: expect.stringContaining('data') });
    expect(await runPtyAction('read', {}, 'owner', registry)).toMatchObject({ error: expect.stringContaining('session_id') });
    expect(await runPtyAction('close', {}, 'owner', registry)).toMatchObject({ error: expect.stringContaining('session_id') });
    expect(registry.clearOwner('owner')).toBe(1);
  });

  it('covers signal variants, empty reads and duplicate create errors', async () => {
    const fake = fakeFactory();
    const registry = new PtyRegistry(() => fake.session);
    registry.create({ owner: 'owner', id: 'p1' });
    expect(await runPtyAction('create', { session_id: 'p1' }, 'owner', registry)).toMatchObject({
      error: expect.stringContaining('已存在'),
    });
    expect((await registry.read('p1', 'owner', 1))?.output).toBe('');
    expect(registry.signal('p1', 'owner', 'SIGTSTP')).toBe(true);
    expect(registry.signal('p1', 'owner', 'SIGQUIT')).toBe(true);
    expect(registry.signal('p1', 'owner', 'SIGTERM')).toBe(true);
    expect(await runTerminalAction('unknown', {}, 'owner', registry)).toMatchObject({
      error: expect.stringContaining('未知'),
    });
  });

  it('falls back to a piped child process', async () => {
    const session = defaultPtyFactory({ command: 'auraxis-no-such-shell' });
    if (!session) throw new Error('piped fallback unavailable');
    let exited = false;
    session.onExit(() => {
      exited = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(exited).toBe(true);
    session.kill();
  });
});
