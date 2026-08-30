import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { parseJson, undoEntrySchema } from './validation.js';

export interface UndoEntry {
  file: string;
  content: string;
  ts: number;
}

const MAX_ENTRIES = 200;

/** 会话作用域的 LIFO 文件修改快照，支持 Write/Edit 前的备份与恢复。 */
export class UndoStore {
  private readonly cache = new Map<string, UndoEntry[]>();

  constructor(private readonly root: string) {}

  private key(scope: string): string {
    return scope || 'default';
  }

  private file(scope: string): string {
    return path.join(this.root, `undo-${encodeURIComponent(this.key(scope))}.json`);
  }

  async push(scope: string, filePath: string, content: string): Promise<void> {
    const list = this.cache.get(this.key(scope)) ?? (await this.load(scope));
    const last = list.at(-1);
    if (last && last.file === filePath && last.content === content) return;
    list.push({ file: filePath, content, ts: Date.now() });
    if (list.length > MAX_ENTRIES) list.shift();
    this.cache.set(this.key(scope), list);
    await this.persist(scope);
  }

  /** 恢复最近一次修改；返回被恢复的条目（无记录时返回 null）。 */
  async revertLatest(scope: string): Promise<UndoEntry | null> {
    const list = this.cache.get(this.key(scope)) ?? (await this.load(scope));
    const entry = list.pop();
    this.cache.set(this.key(scope), list);
    if (!entry) return null;
    await fsp.mkdir(path.dirname(entry.file), { recursive: true });
    await fsp.writeFile(entry.file, entry.content, 'utf8');
    await this.persist(scope);
    return entry;
  }

  private async load(scope: string): Promise<UndoEntry[]> {
    try {
      const raw = await fsp.readFile(this.file(scope), 'utf8');
      const parsed = parseJson(raw);
      return Array.isArray(parsed)
        ? parsed.flatMap((entry) => {
            const result = undoEntrySchema.safeParse(entry);
            return result.success ? [result.data] : [];
          })
        : [];
    } catch {
      return [];
    }
  }

  private async persist(scope: string): Promise<void> {
    const list = this.cache.get(this.key(scope)) ?? [];
    await fsp.mkdir(this.root, { recursive: true });
    await fsp.writeFile(this.file(scope), `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  }
}
