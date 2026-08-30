import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppServer } from '../appserver.js';
import { SessionStore } from '../session/store.js';

let root = '';

afterEach(async () => {
  delete process.env.AURAXIS_HOME;
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = '';
});

describe('AppServer threads', () => {
  it('resumes and forks a thread using the stored model', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-appserver-'));
    process.env.AURAXIS_HOME = root;
    const store = new SessionStore({ dir: path.join(root, 'sessions') });
    const persisted = await store.create(root, 'resumed-model', 'deepseek');
    const server = new AppServer({
      projectRoot: root,
      model: 'global-model',
      provider: 'deepseek',
      apiKey: 'key',
      apiBase: 'https://api.deepseek.com',
      mode: 'auto',
      sandboxMode: 'workspace-write',
      reasoningEffort: 'high',
      toolChoice: 'auto',
    });
    await server.start();

    const resume = await server.handleLine(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'thread/resume', params: { threadId: persisted.id } }),
    );
    const parsedResume = JSON.parse(resume[0]) as { result?: { thread?: { id: string } } };
    expect(parsedResume.result?.thread?.id).toBe(persisted.id);

    const fork = await server.handleLine(
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'thread/fork', params: { threadId: persisted.id } }),
    );
    const forkResponse = fork.find((line) => line.includes('"id":2'));
    const parsedFork = JSON.parse(forkResponse || '{}') as { result?: { thread?: { id: string } } };
    const forkId = parsedFork.result?.thread?.id;
    expect(forkId).toBeTruthy();

    const list = await server.handleLine(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'thread/list', params: {} }));
    const parsedList = JSON.parse(list[0]) as {
      result?: { threads?: Array<{ id: string; model: string }> };
    };
    const resumed = parsedList.result?.threads?.find((thread) => thread.id === persisted.id);
    const forked = parsedList.result?.threads?.find((thread) => thread.id === forkId);
    expect(resumed?.model).toBe('resumed-model');
    expect(forked?.model).toBe('resumed-model');

    await server.close();
  });
});
