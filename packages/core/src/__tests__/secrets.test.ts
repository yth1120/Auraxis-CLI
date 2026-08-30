import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SecretStore } from '../secrets.js';

async function tempStore(): Promise<{ dir: string; store: SecretStore }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-secrets-'));
  return { dir, store: new SecretStore(path.join(dir, 'credentials.json'), path.join(dir, 'machine.key')) };
}

describe('SecretStore', () => {
  it('encrypts, reads and deletes credentials', async () => {
    const { dir, store } = await tempStore();
    try {
      await store.set('DEEPSEEK_API_KEY', 'sk-test');
      expect(await store.get('DEEPSEEK_API_KEY')).toBe('sk-test');
      expect(await store.get('missing')).toBeUndefined();
      await store.delete('DEEPSEEK_API_KEY');
      expect(await store.get('DEEPSEEK_API_KEY')).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('survives a corrupt credential file and returns empty values', async () => {
    const { dir, store } = await tempStore();
    try {
      await fs.writeFile(path.join(dir, 'credentials.json'), '{bad', 'utf8');
      expect(await store.get('anything')).toBeUndefined();
      await store.set('A', 'value');
      expect(await store.get('A')).toBe('value');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('returns undefined for tampered ciphertext', async () => {
    const { dir, store } = await tempStore();
    try {
      await store.set('A', 'value');
      const file = path.join(dir, 'credentials.json');
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      data.entries.A.data = Buffer.from('bad').toString('base64');
      await fs.writeFile(file, JSON.stringify(data), 'utf8');
      expect(await store.get('A')).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
