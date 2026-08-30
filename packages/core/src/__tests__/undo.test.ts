import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { UndoStore } from '../undo.js';
import { writeFileTool, editFileTool } from '../tools/files.js';
import type { ToolContext } from '../tools/registry.js';

let root = '';
let undoRoot = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-undo-file-'));
  undoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-undo-store-'));
});

function context(sessionId: string, undo: UndoStore): ToolContext {
  return {
    projectRoot: root,
    sessionId,
    undo,
    emit: () => {},
    todos: [],
    setTodos: () => {},
  };
}

describe('UndoStore', () => {
  it('pushes and reverts the latest write, persisting across instances', async () => {
    const file = path.join(root, 'a.txt');
    await fs.writeFile(file, 'old', 'utf8');
    const first = new UndoStore(undoRoot);
    await first.push('s1', file, 'old');

    const fresh = new UndoStore(undoRoot);
    const entry = await fresh.revertLatest('s1');
    expect(entry).toMatchObject({ file, content: 'old' });
    expect(await fresh.revertLatest('s1')).toBeNull();
  });
});

describe('file tools with undo', () => {
  it('snapshots the previous content on Write and restores it', async () => {
    const file = path.join(root, 'a.txt');
    await fs.writeFile(file, 'old', 'utf8');
    const undo = new UndoStore(undoRoot);
    const ctx = context('s1', undo);

    await writeFileTool({ file_path: 'a.txt', content: 'new' }, ctx);
    expect(await fs.readFile(file, 'utf8')).toBe('new');
    await undo.revertLatest('s1');
    expect(await fs.readFile(file, 'utf8')).toBe('old');
  });

  it('snapshots the previous content on Edit and restores it', async () => {
    const file = path.join(root, 'a.txt');
    await fs.writeFile(file, 'const a = 1;', 'utf8');
    const undo = new UndoStore(undoRoot);
    const ctx = context('s1', undo);

    await editFileTool({ file_path: 'a.txt', old_string: 'const a = 1;', new_string: 'const a = 2;' }, ctx);
    expect(await fs.readFile(file, 'utf8')).toBe('const a = 2;');
    await undo.revertLatest('s1');
    expect(await fs.readFile(file, 'utf8')).toBe('const a = 1;');
  });

  it('does not snapshot brand-new files', async () => {
    const undo = new UndoStore(undoRoot);
    const ctx = context('s1', undo);
    await writeFileTool({ file_path: 'fresh.txt', content: 'hi' }, ctx);
    expect(await undo.revertLatest('s1')).toBeNull();
  });
});
