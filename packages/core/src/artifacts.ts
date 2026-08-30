import fsp from 'node:fs/promises';
import path from 'node:path';

export async function publishArtifact(projectRoot: string, title: string, content: string): Promise<string> {
  const safeTitle = title.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'artifact';
  const dir = path.join(projectRoot, '.auraxis', 'artifacts');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${safeTitle}-${Date.now().toString(36)}.md`);
  await fsp.writeFile(file, `# ${title}\n\n${content}\n`, 'utf8');
  return file;
}

export async function listArtifacts(projectRoot: string): Promise<string[]> {
  try {
    const dir = path.join(projectRoot, '.auraxis', 'artifacts');
    const entries = await fsp.readdir(dir);
    return entries.filter((entry) => entry.endsWith('.md')).sort().slice(-50);
  } catch {
    return [];
  }
}
