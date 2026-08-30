import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { editFileTool, readFileTool, writeFileTool } from '../tools/files.js';
import { MemoryStore } from '../memory.js';
import { UndoStore } from '../undo.js';
import { scanSkills } from '../skills.js';
import { bashTool } from '../tools/shell.js';
import type { ToolContext } from '../tools/registry.js';

const spawnMock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock.spawn }));

function context(root: string): ToolContext {
  return { projectRoot: root, emit: () => {}, todos: [], setTodos: () => {} };
}

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

beforeEach(() => {
  spawnMock.spawn.mockReset();
  spawnMock.spawn.mockReturnValue(fakeChild() as never);
});

describe('edge paths', () => {
  it('truncates large reads and handles repeated edits', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-edge-'));
    try {
      const large = 'x'.repeat(600_000);
      await fs.writeFile(path.join(root, 'large.txt'), large, 'utf8');
      const result = await readFileTool({ file_path: 'large.txt' }, context(root));
      expect(result.content).toContain('已截断');
      await writeFileTool({ file_path: 'dup.txt', content: 'a a a' }, context(root));
      await expect(editFileTool({ file_path: 'dup.txt', old_string: 'a', new_string: 'b' }, context(root))).rejects.toThrow('replace_all');
      await editFileTool({ file_path: 'dup.txt', old_string: 'a', new_string: 'b', replace_all: true }, context(root));
      expect(await fs.readFile(path.join(root, 'dup.txt'), 'utf8')).toBe('b b b');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('handles missing memory files and invalid skill frontmatter', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-edge-memory-'));
    try {
      expect(await new MemoryStore(path.join(root, 'missing', 'memory.json')).load()).toEqual([]);
      const skillDir = path.join(root, '.auraxis', 'skills', 'plain');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'no frontmatter', 'utf8');
      expect((await scanSkills(root))[0]).toMatchObject({ id: 'plain', name: 'plain' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('deduplicates undo entries and tolerates corrupt undo files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-edge-undo-'));
    try {
      const store = new UndoStore(path.join(root, 'undo'));
      const file = path.join(root, 'x.txt');
      await store.push('s', file, 'same');
      await store.push('s', file, 'same');
      expect((await store.revertLatest('s'))?.content).toBe('same');
      await fs.writeFile(path.join(root, 'undo', 'undo-s.json'), '{bad', 'utf8');
      expect(await store.revertLatest('s')).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('uses AURAXIS_SHELL when configured', async () => {
    const previous = process.env.AURAXIS_SHELL;
    process.env.AURAXIS_SHELL = 'fish';
    try {
      const child = fakeChild();
      spawnMock.spawn.mockReturnValue(child as never);
      const pending = bashTool({ command: 'echo hi' }, context('/project'));
      await vi.waitFor(() => expect(spawnMock.spawn).toHaveBeenCalled());
      expect(spawnMock.spawn.mock.calls[0][0]).toBe('fish');
      child.emit('close', 0);
      await pending;
    } finally {
      if (previous === undefined) delete process.env.AURAXIS_SHELL;
      else process.env.AURAXIS_SHELL = previous;
    }
  });
});
