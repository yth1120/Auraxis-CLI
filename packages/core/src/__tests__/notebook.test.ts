import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { notebookEditTool } from '../tools/notebook.js';
import type { ToolContext } from '../tools/registry.js';

let dir = '';
afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
  dir = '';
});

function context(projectRoot: string): ToolContext {
  return { projectRoot, sessionId: 'nb', emit: () => {}, todos: [], setTodos: () => {} } as ToolContext;
}

describe('NotebookEdit', () => {
  it('reads, writes, inserts and deletes cells', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-nb-'));
    const file = path.join(dir, 'nb.ipynb');
    await fs.writeFile(file, JSON.stringify({ cells: [{ cell_type: 'code', source: ['print(1)'] }] }), 'utf8');
    const ctx = context(dir);
    const undoFile: string[] = [];
    ctx.undo = {
      push: async (_scope: string, file: string) => {
        undoFile.push(file);
      },
      revertLatest: async () => null,
    } as never;
    expect((await notebookEditTool({ file_path: 'nb.ipynb', action: 'read', cell_index: 0 }, ctx)).content).toContain('print(1)');
    await notebookEditTool({ file_path: 'nb.ipynb', action: 'write', cell_index: 0, source: 'print(2)' }, ctx);
    await notebookEditTool({ file_path: 'nb.ipynb', action: 'insert', cell_index: 1, source: 'print(3)', cell_type: 'markdown' }, ctx);
    expect(undoFile.length).toBeGreaterThan(0);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).cells).toHaveLength(2);
    await notebookEditTool({ file_path: 'nb.ipynb', action: 'delete', cell_index: 0 }, ctx);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).cells).toHaveLength(1);
  });

  it('rejects invalid files, indexes and actions', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-nb-bad-'));
    const ctx = context(dir);
    await expect(notebookEditTool({ file_path: 'missing.ipynb' }, ctx)).rejects.toThrow('文件不存在');
    await expect(notebookEditTool({ file_path: 'x.txt' }, ctx)).rejects.toThrow('.ipynb');
    await fs.writeFile(path.join(dir, 'bad.ipynb'), '{bad', 'utf8');
    await expect(notebookEditTool({ file_path: 'bad.ipynb' }, ctx)).rejects.toThrow();
    await fs.writeFile(path.join(dir, 'nb.ipynb'), JSON.stringify({ cells: [{ cell_type: 'code', source: [] }] }), 'utf8');
    await expect(notebookEditTool({ file_path: 'nb.ipynb', cell_index: 1 }, ctx)).rejects.toThrow('超出范围');
    await expect(notebookEditTool({ file_path: 'nb.ipynb', action: 'write', cell_index: 0 }, ctx)).rejects.toThrow('source');
    await expect(notebookEditTool({ file_path: 'nb.ipynb', action: 'insert', cell_index: 0 }, ctx)).rejects.toThrow('source');
    await expect(notebookEditTool({ file_path: 'nb.ipynb', action: 'bogus', cell_index: 0 }, ctx)).rejects.toThrow('未知操作');
  });
});
