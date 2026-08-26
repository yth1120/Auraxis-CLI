import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  file: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

async function scanDir(dir: string): Promise<SkillRecord[]> {
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const skills: SkillRecord[] = [];
  for (const entry of entries) {
    const skillDir = path.join(dir, entry);
    const skillFile = path.join(skillDir, 'SKILL.md');
    try {
      const stat = await fsp.stat(skillFile);
      if (!stat.isFile()) continue;
      const content = await fsp.readFile(skillFile, 'utf8');
      const meta = parseFrontmatter(content);
      const id = meta.id || entry;
      skills.push({
        id,
        name: meta.name || entry,
        description: meta.description || '',
        file: skillFile,
      });
    } catch {
      /* ignore invalid skill directories */
    }
  }
  return skills;
}

export async function scanSkills(projectRoot: string): Promise<SkillRecord[]> {
  const roots = [
    path.join(projectRoot, '.auraxis', 'skills'),
    path.join(projectRoot, 'skills'),
    path.join(os.homedir(), '.auraxis', 'skills'),
  ];
  const all: SkillRecord[] = [];
  for (const root of roots) {
    all.push(...(await scanDir(root)));
  }
  const map = new Map<string, SkillRecord>();
  for (const skill of all) map.set(skill.id, skill);
  return [...map.values()];
}

export async function readSkillContent(skill: SkillRecord): Promise<string> {
  return fsp.readFile(skill.file, 'utf8');
}

