import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { editFileTool, readFileTool, writeFileTool } from '../tools/files.js';
import type { ToolContext } from '../tools/registry.js';
import { truncateText } from '../events.js';

function context(root: string): ToolContext {
  return {
    projectRoot: root,
    emit: () => {},
    todos: [],
    setTodos: () => {},
  };
}

describe('file tools', () => {
  it('writes and reads files safely', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-files-'));
    await writeFileTool({ file_path: 'src/a.ts', content: 'const a = 1;\n' }, context(root));
    const result = await readFileTool({ file_path: 'src/a.ts' }, context(root));
    expect(result.content).toContain('const a = 1;');
  });

  it('rejects paths outside the project', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-files-'));
    await expect(readFileTool({ file_path: '../secret.txt' }, context(root))).rejects.toThrow('超出项目根目录');
  });

  it('edits only an exact string', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-files-'));
    await writeFileTool({ file_path: 'a.ts', content: 'const a = 1;' }, context(root));
    await editFileTool({ file_path: 'a.ts', old_string: 'const a = 1;', new_string: 'const a = 2;' }, context(root));
    expect(await fs.readFile(path.join(root, 'a.ts'), 'utf8')).toBe('const a = 2;');
  });
});

describe('truncateText', () => {
  it('shortens long output', () => {
    expect(truncateText('a '.repeat(100), 20)).toHaveLength(20);
  });
});

