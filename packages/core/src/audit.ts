import fsp from 'node:fs/promises';
import path from 'node:path';
import { auditRecordSchema, parseJson } from './validation.js';

export interface AuditRecord {
  ts: number;
  sessionId: string;
  type: string;
  data: unknown;
}

export class AuditStore {
  constructor(private readonly file: string) {}

  static session(projectRoot: string, sessionId: string): AuditStore {
    return new AuditStore(path.join(projectRoot, '.auraxis', 'audit', `${sessionId}.jsonl`));
  }

  async append(entry: Omit<AuditRecord, 'ts' | 'sessionId'> & { sessionId?: string }): Promise<void> {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    const record: AuditRecord = {
      ts: Date.now(),
      sessionId: entry.sessionId || path.basename(this.file, '.jsonl'),
      type: entry.type,
      data: entry.data,
    };
    await fsp.appendFile(this.file, `${JSON.stringify(record)}\n`, 'utf8');
  }

  async read(limit = 100): Promise<AuditRecord[]> {
    try {
      const raw = await fsp.readFile(this.file, 'utf8');
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .flatMap((line) => {
          const parsed = auditRecordSchema.safeParse(parseJson(line));
          return parsed.success ? [parsed.data as AuditRecord] : [];
        })
        .slice(-limit);
    } catch {
      return [];
    }
  }
}
