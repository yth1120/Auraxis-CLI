import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  editFileTool,
  deleteFileTool,
  globTool,
  grepTool,
  readFileTool,
  readImageFileTool,
  runFileTools,
  writeFileTool,
} from '../tools/files.js';
import type { ToolContext } from '../tools/registry.js';

function context(root: string, extra: Partial<ToolContext> = {}): ToolContext {
  return { projectRoot: root, emit: () => {}, todos: [], setTodos: () => {}, ...extra };
}

describe('file tool extras', () => {
  it('lists, greps and globs project files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-files-extra-'));
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'a.ts'), 'const answer = 42;\n// TODO', 'utf8');
      expect((await runFileTools({ path: 'src' }, context(root))).content).toContain('a.ts');
      expect((await grepTool({ pattern: 'answer', path: 'src' }, context(root))).content).toContain('const answer');
      const fileGrep = await grepTool({ pattern: 'answer', path: 'src/a.ts', max_matches: 1 }, context(root));
      expect(fileGrep.content).toContain('answer');
      const glob = await globTool({ pattern: '**/*.ts', cwd: 'src' }, context(root));
      expect(glob.content).toContain('a.ts');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('enforces undo on overwrite and supports read-only mode', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-files-undo-'));
    try {
      await writeFileTool({ file_path: 'a.txt', content: 'old' }, context(root));
      const undo: { file: string; content: string } = { file: '', content: '' };
      await writeFileTool(
        { file_path: 'a.txt', content: 'new' },
        context(root, {
          undo: {
            push: async (_scope: string, file: string, content: string) => {
              undo.file = file;
              undo.content = content;
            },
            revertLatest: async () => null,
          } as unknown as NonNullable<ToolContext['undo']>,
        }),
      );
      expect(undo).toMatchObject({ content: 'old' });
      const readOnly = context(root, { sandbox: { mode: 'read', assertPath: () => { throw new Error('read-only'); } } as never });
      await expect(writeFileTool({ file_path: 'a.txt', content: 'x' }, readOnly)).rejects.toThrow('read-only');
      await expect(readFileTool({ file_path: 'missing.txt' }, context(root))).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects unsupported image formats and reads valid images', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-image-'));
    try {
      await fs.writeFile(path.join(root, 'a.txt'), 'not image', 'utf8');
      await expect(readImageFileTool({ file_path: 'a.txt' }, context(root))).rejects.toThrow('仅支持');
      await fs.writeFile(path.join(root, 'big.png'), Buffer.alloc(11 * 1024 * 1024));
      await expect(readImageFileTool({ file_path: 'big.png' }, context(root))).rejects.toThrow('超过 10MB');
      const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8ff3f0004010001a815f00000000049454e44ae426082', 'hex');
      await fs.writeFile(path.join(root, 'pixel.png'), png);
      const result = await readImageFileTool({ file_path: 'pixel.png', prompt: 'look' }, context(root));
      expect(result.artifact).toMatchObject({ mimeType: 'image/png', prompt: 'look' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('deletes files and directories through the registered tool', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-delete-'));
    try {
      await fs.writeFile(path.join(root, 'a.txt'), 'x', 'utf8');
      expect((await deleteFileTool({ file_path: 'a.txt' }, context(root))).content).toContain('已删除');
      await expect(fs.stat(path.join(root, 'a.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
      await fs.mkdir(path.join(root, 'dir'));
      await expect(deleteFileTool({ file_path: 'dir' }, context(root))).rejects.toThrow('recursive=true');
      expect((await deleteFileTool({ file_path: 'dir', recursive: true }, context(root))).content).toContain('已删除');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('covers tool edge cases: regex, directories, missing strings and empty globs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-files-edge-'));
    try {
      await fs.mkdir(path.join(root, 'dir'), { recursive: true });
      await fs.writeFile(path.join(root, 'a.txt'), 'hello', 'utf8');
      await expect(grepTool({ pattern: '[' }, context(root))).rejects.toThrow('无效正则');
      await expect(runFileTools({ path: 'a.txt' }, context(root))).rejects.toThrow('不是目录');
      await expect(runFileTools({ path: '../outside' }, context(root))).rejects.toThrow('超出项目根目录');
      await expect(editFileTool({ file_path: 'a.txt', old_string: 'missing', new_string: 'x' }, context(root))).rejects.toThrow('未找到');
      await expect(readFileTool({ file_path: 'dir' }, context(root))).rejects.toThrow('目录');
      expect((await globTool({ pattern: '*.none' }, context(root))).content).toContain('未找到');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
