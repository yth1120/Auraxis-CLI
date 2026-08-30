import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPermissionPreview } from '../engine/preview.js';

describe('permission preview', () => {
  it('renders write, edit, shell and default previews', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-preview-'));
    try {
      await fs.writeFile(path.join(root, 'a.ts'), 'old', 'utf8');
      expect(await buildPermissionPreview('Write', { file_path: 'a.ts', content: 'new' }, root)).toContain('+ new');
      expect(await buildPermissionPreview('Write', { file_path: 'new.ts', content: 'new' }, root)).toContain('（新文件）');
      expect(await buildPermissionPreview('Edit', { file_path: 'a.ts', old_string: 'old', new_string: 'new' }, root)).toContain('+ new');
      expect(await buildPermissionPreview('Bash', { command: 'ls' }, root)).toContain('$ ls');
      expect(await buildPermissionPreview('Pwsh', { command: 'Get-Location' }, root)).toContain('Get-Location');
      expect(await buildPermissionPreview('WebFetch', { url: 'https://example.com' }, root)).toContain('URL');
      expect(await buildPermissionPreview('WebSearch', { query: 'q' }, root)).toContain('Query');
      expect(await buildPermissionPreview('Other', { a: 1 }, root)).toContain('"a"');
      expect(await buildPermissionPreview('Write', { file_path: '../outside' }, root)).toBe('');
      const samePreview = await buildPermissionPreview('Write', { file_path: 'a.ts', content: 'old' }, root);
      expect(samePreview).not.toContain('- old');
      expect(samePreview).not.toContain('+ old');
      await fs.writeFile(path.join(root, 'new.txt'), '', 'utf8');
      expect(await buildPermissionPreview('Edit', { file_path: 'new.txt', old_string: 'missing', new_string: 'x' }, root)).toContain('new.txt');
      expect(await buildPermissionPreview('Write', {}, root)).toBe('');
      expect(await buildPermissionPreview('Write', { file_path: 1 }, root)).toBe('');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
