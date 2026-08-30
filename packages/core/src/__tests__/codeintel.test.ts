import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findSymbols, scanSymbols } from '../codeintel.js';

describe('code intelligence', () => {
  it('finds symbols from source files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-codesearch-'));
    try {
      await fs.writeFile(path.join(root, 'main.ts'), 'export function greet(name: string) {}\nexport class User {}', 'utf8');
      const symbols = await scanSymbols(root);
      expect(symbols.map((item) => item.name)).toContain('greet');
      expect(symbols.map((item) => item.name)).toContain('User');
      expect(await findSymbols(root, 'greet')).toHaveLength(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
