import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { credentialFileSchema, parseJson } from './validation.js';

interface EncryptedEntry {
  iv: string;
  tag: string;
  data: string;
}

interface CredentialFile {
  version: 1;
  entries: Record<string, EncryptedEntry>;
}

export class SecretStore {
  constructor(
    private readonly credentialsFile: string,
    private readonly keyFile: string,
  ) {}

  private async getKey(): Promise<Buffer> {
    try {
      const raw = await fs.readFile(this.keyFile);
      if (raw.length >= 32) return raw.subarray(0, 32);
    } catch {
      /* generate below */
    }
    const key = crypto.randomBytes(32);
    await fs.mkdir(path.dirname(this.keyFile), { recursive: true });
    await fs.writeFile(this.keyFile, key, { mode: 0o600 });
    return key;
  }

  private async readFile(): Promise<CredentialFile> {
    try {
      const raw = await fs.readFile(this.credentialsFile, 'utf8');
      const parsed = credentialFileSchema.safeParse(parseJson(raw));
      if (parsed.success) return parsed.data as CredentialFile;
    } catch {
      /* missing file */
    }
    return { version: 1, entries: {} };
  }

  private async writeFile(data: CredentialFile): Promise<void> {
    await fs.mkdir(path.dirname(this.credentialsFile), { recursive: true });
    await fs.writeFile(this.credentialsFile, `${JSON.stringify(data, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  async get(name: string): Promise<string | undefined> {
    const file = await this.readFile();
    const entry = file.entries[name];
    if (!entry) return undefined;
    const key = await this.getKey();
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
      const decrypted = Buffer.concat([decipher.update(Buffer.from(entry.data, 'base64')), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      return undefined;
    }
  }

  async set(name: string, value: string): Promise<void> {
    const file = await this.readFile();
    const key = await this.getKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    file.entries[name] = {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64'),
    };
    await this.writeFile(file);
  }

  async delete(name: string): Promise<void> {
    const file = await this.readFile();
    delete file.entries[name];
    await this.writeFile(file);
  }
}
