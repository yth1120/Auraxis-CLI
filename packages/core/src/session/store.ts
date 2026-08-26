import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { SessionRecord } from '../types.js';

export interface SessionStoreOptions {
  dir: string;
}

function projectSlug(root: string): string {
  return path.basename(root).replace(/[^\w.-]+/g, '_') || 'root';
}

export class SessionStore {
  readonly dir: string;

  constructor(options: SessionStoreOptions) {
    this.dir = options.dir;
  }

  private fileFor(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  async ensure(): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true });
  }

  async create(projectRoot: string, model: string): Promise<SessionRecord> {
    await this.ensure();
    const record: SessionRecord = {
      id: `s_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
      projectRoot: path.resolve(projectRoot),
      model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    await this.save(record);
    return record;
  }

  async save(record: SessionRecord): Promise<void> {
    await this.ensure();
    record.updatedAt = Date.now();
    await fsp.writeFile(this.fileFor(record.id), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  }

  async load(id: string): Promise<SessionRecord | null> {
    try {
      const raw = await fsp.readFile(this.fileFor(id), 'utf8');
      const value = JSON.parse(raw) as SessionRecord;
      if (!value || typeof value.id !== 'string' || !Array.isArray(value.messages)) return null;
      return value;
    } catch {
      return null;
    }
  }

  async list(projectRoot?: string): Promise<SessionRecord[]> {
    try {
      const entries = await fsp.readdir(this.dir);
      const sessions: SessionRecord[] = [];
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        const session = await this.load(entry.slice(0, -5));
        if (!session) continue;
        if (projectRoot && path.resolve(session.projectRoot) !== path.resolve(projectRoot)) continue;
        sessions.push(session);
      }
      return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await fsp.unlink(this.fileFor(id));
    } catch {
      /* already gone */
    }
  }
}

