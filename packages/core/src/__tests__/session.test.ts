import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionStore } from '../session/store.js';

describe('SessionStore', () => {
  it('creates, loads, lists and removes sessions', async () => {
    const dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-session-')), 'sessions');
    const store = new SessionStore({ dir });
    const session = await store.create('/tmp/project', 'deepseek-v4-pro');
    session.messages = [{ role: 'user', content: 'hello' }];
    await store.save(session);

    const loaded = await store.load(session.id);
    expect(loaded?.messages[0].content).toBe('hello');

    const list = await store.list();
    expect(list).toHaveLength(1);

    await store.remove(session.id);
    expect(await store.load(session.id)).toBeNull();
  });

  it('skips corrupt files and filters by project', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-session-extra-'));
    const dir = path.join(root, 'sessions');
    const store = new SessionStore({ dir });
    const a = await store.create('/tmp/a', 'm');
    const b = await store.create('/tmp/b', 'm');
    await fs.writeFile(path.join(dir, 'broken.json'), '{bad', 'utf8');
    expect(await store.load('broken')).toBeNull();
    expect((await store.list('/tmp/a')).map((session) => session.id)).toEqual([a.id]);
    await store.remove(b.id);
    expect((await store.list()).map((session) => session.id)).toEqual([a.id]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('ensures its directory and handles missing directories', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-session-missing-'));
    const dir = path.join(root, 'missing-sessions');
    const store = new SessionStore({ dir });
    await store.ensure();
    await expect(fs.stat(dir)).resolves.toMatchObject({});
    await fs.rm(dir, { recursive: true, force: true });
    expect(await store.list()).toEqual([]);
    await fs.rm(root, { recursive: true, force: true });
  });
});
