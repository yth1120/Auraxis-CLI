import { describe, expect, it } from 'vitest';
import { PermissionGate } from '../engine/permissions.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

describe('PermissionGate', () => {
  it('allows read-only tools without asking', async () => {
    const gate = new PermissionGate({ mode: 'ask', sandboxMode: 'workspace-write', projectRoot: '/tmp/project' });
    const result = await gate.allow('Read', 'read', { file_path: 'a.ts' });
    expect(result.allowed).toBe(true);
  });

  it('asks for write tools in ask mode', async () => {
    let asked = false;
    const gate = new PermissionGate({
      mode: 'ask',
      sandboxMode: 'workspace-write',
      projectRoot: '/tmp/project',
      requestPermission: async () => {
        asked = true;
        return 'allow_once';
      },
    });
    const result = await gate.allow('Write', 'write', { file_path: 'a.ts' });
    expect(asked).toBe(true);
    expect(result.allowed).toBe(true);
  });

  it('blocks writes in read sandbox', async () => {
    const gate = new PermissionGate({ mode: 'auto', sandboxMode: 'read', projectRoot: '/tmp/project' });
    const result = await gate.allow('Write', 'write', { file_path: 'a.ts' });
    expect(result.allowed).toBe(false);
  });

  it('includes a file preview for write requests', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-permission-'));
    await fs.writeFile(path.join(root, 'a.ts'), 'old', 'utf8');
    let request: { preview?: string } | undefined;
    const gate = new PermissionGate({
      mode: 'ask',
      sandboxMode: 'workspace-write',
      projectRoot: root,
      requestPermission: async (value) => {
        request = value;
        return 'allow_once';
      },
    });
    await gate.allow('Write', 'write', { file_path: 'a.ts', content: 'new' });
    expect(request?.preview).toContain('---');
    expect(request?.preview).toContain('+ new');
  });
});
