import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanSkills, readSkillContent } from '../skills.js';

describe('skills', () => {
  it('discovers and reads project skills', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-skills-'));
    const skillDir = path.join(root, '.auraxis', 'skills', 'review');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nid: code-review\nname: Code Review\n---\nReview rules.',
      'utf8',
    );
    const skills = await scanSkills(root);
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe('code-review');
    expect(await readSkillContent(skills[0])).toContain('Review rules');
  });
});

