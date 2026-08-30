import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findSymbols, scanSymbols } from '../codeintel.js';
import { readSkillContent, scanSkills } from '../skills.js';

describe('code intelligence', () => {
  it('scans symbols and returns matched records', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-intel-'));
    try {
      await fs.writeFile(path.join(root, 'a.ts'), 'export function hello() {}\nconst world = 1;\n', 'utf8');
      const symbols = await scanSymbols(root);
      expect(symbols.map((symbol) => symbol.name)).toEqual(expect.arrayContaining(['hello', 'world']));
      expect(await findSymbols(root, 'HELLO')).toHaveLength(1);
      expect(await findSymbols(root, 'h', 1)).toHaveLength(1);
      expect(await findSymbols(root, '')).toEqual([]);
      await fs.writeFile(path.join(root, 'large.ts'), 'x'.repeat(600_000), 'utf8');
      expect((await scanSymbols(root)).length).toBeLessThanOrEqual(2);
      const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-intel-empty-'));
      expect(await scanSymbols(empty)).toEqual([]);
      await fs.rm(empty, { recursive: true, force: true });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('skills', () => {
  it('scans project and global skills with frontmatter fallback', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-skills-'));
    try {
      const skillDir = path.join(root, '.auraxis', 'skills', 'demo');
      await fs.mkdir(skillDir, { recursive: true });
      const file = path.join(skillDir, 'SKILL.md');
      await fs.writeFile(file, '---\nid: demo-id\nname: Demo\ndescription: test\n---\ncontent', 'utf8');
      const skills = await scanSkills(root);
      expect(skills[0]).toMatchObject({ id: 'demo-id', name: 'Demo' });
      expect(await readSkillContent(skills[0])).toContain('content');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
