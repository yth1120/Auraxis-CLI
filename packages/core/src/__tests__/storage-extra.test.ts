import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { todoWriteTool } from '../tools/todo.js';
import { publishArtifact, listArtifacts } from '../artifacts.js';
import { AuditStore } from '../audit.js';
import { SessionMailbox } from '../mailbox.js';
import { UndoStore } from '../undo.js';
import type { ToolContext } from '../tools/registry.js';

describe('storage and small tools', () => {
  it('writes todos and normalizes statuses', async () => {
    let next: unknown[] = [];
    const ctx: ToolContext = {
      projectRoot: '/project',
      emit: () => {},
      todos: [],
      setTodos: (value) => {
        next = value;
      },
    };
    const result = await todoWriteTool(
      {
        todos: [
          { id: '1', description: 'one', status: 'completed' },
          { description: 'two', status: 'bad' },
        ],
      },
      ctx,
    );
    expect(result.content).toContain('1/2');
    expect(next).toHaveLength(2);
    await expect(todoWriteTool({ todos: 'bad' }, ctx)).rejects.toThrow('数组');
  });

  it('publishes and lists markdown artifacts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-artifacts-'));
    const file = await publishArtifact(root, 'hello', 'body');
    expect(await fs.readFile(file, 'utf8')).toContain('# hello');
    expect(await listArtifacts(root)).toHaveLength(1);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('stores and reads audit records and mailbox messages', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-store-extra-'));
    const audit = new AuditStore(path.join(root, 'audit.jsonl'));
    await audit.append({ type: 'text_chunk', data: { text: 'hello' } });
    expect(await audit.read(10)).toHaveLength(1);
    await fs.writeFile(path.join(root, 'audit.jsonl'), '{broken\n', 'utf8');
    expect(await audit.read()).toEqual([]);

    const mailbox = new SessionMailbox(path.join(root, 'mailbox.json'));
    await mailbox.send('a', 'b', 'hi');
    expect((await mailbox.list('b')).map((message) => message.text)).toContain('hi');
    await fs.writeFile(path.join(root, 'mailbox.json'), '{bad', 'utf8');
    expect(await mailbox.list('b')).toEqual([]);
    await mailbox.send('c', 'd', 'again');
    expect((await mailbox.list('d'))[0]?.text).toBe('again');
    await fs.rm(root, { recursive: true, force: true });
  });

  it('undoes file changes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-undo-extra-'));
    const store = new UndoStore(path.join(root, 'undo'));
    const file = path.join(root, 'a.txt');
    await fs.writeFile(file, 'old', 'utf8');
    await store.push('scope', file, 'old');
    const other = path.join(root, 'b.txt');
    await store.push('scope', other, 'other');
    await fs.writeFile(other, 'new', 'utf8');
    const entry = await store.revertLatest('scope');
    expect(entry?.file).toBe(other);
    expect(await fs.readFile(file, 'utf8')).toBe('old');
    expect((await store.revertLatest('scope'))?.file).toBe(file);
    await fs.rm(root, { recursive: true, force: true });
  });
});
