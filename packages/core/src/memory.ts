import fsp from 'node:fs/promises';
import path from 'node:path';
import { getAppPaths } from './config.js';
import { memoryRecordSchema, parseJson } from './validation.js';

export interface MemoryRecord {
  id: string;
  title: string;
  content: string;
  tags: string[];
  updatedAt: number;
}

export class MemoryStore {
  constructor(private readonly file: string) {}

  static project(root: string): MemoryStore {
    return new MemoryStore(path.join(root, '.auraxis', 'memory.json'));
  }

  static global(): MemoryStore {
    return new MemoryStore(path.join(getAppPaths().home, 'memory.json'));
  }

  async load(): Promise<MemoryRecord[]> {
    try {
      const raw = await fsp.readFile(this.file, 'utf8');
      const parsed = parseJson(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((item) => {
        const result = memoryRecordSchema.safeParse(item);
        return result.success ? [result.data] : [];
      });
    } catch {
      return [];
    }
  }

  async save(records: MemoryRecord[]): Promise<void> {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.writeFile(this.file, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  }

  async remember(title: string, content: string, tags: string[] = []): Promise<MemoryRecord> {
    const records = await this.load();
    const id = `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const record: MemoryRecord = { id, title, content, tags: [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))], updatedAt: Date.now() };
    records.push(record);
    await this.save(records.slice(-200));
    return record;
  }

  async search(query: string, limit = 10): Promise<MemoryRecord[]> {
    const records = await this.load();
    const keyword = query.trim().toLowerCase();
    return records
      .filter((record) => !keyword || `${record.title} ${record.content} ${record.tags.join(' ')}`.toLowerCase().includes(keyword))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }
}

export async function loadMemoryContext(projectRoot: string, limit = 10): Promise<string> {
  const project = await MemoryStore.project(projectRoot).search('', limit);
  const global = await MemoryStore.global().search('', limit);
  const records = [...project, ...global].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  if (!records.length) return '';
  return records
    .map((record) => `- ${record.title}${record.tags.length ? ` [${record.tags.join(', ')}]` : ''}\n  ${record.content.slice(0, 600)}`)
    .join('\n');
}
