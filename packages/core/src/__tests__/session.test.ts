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
});

