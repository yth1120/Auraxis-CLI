import { describe, expect, it } from 'vitest';
import { PermissionGate } from '../engine/permissions.js';

describe('PermissionGate', () => {
  it('allows read-only tools without asking', async () => {
    const gate = new PermissionGate({ mode: 'ask', sandboxMode: 'workspace-write' });
    const result = await gate.allow('Read', 'read', { file_path: 'a.ts' });
    expect(result.allowed).toBe(true);
  });

  it('asks for write tools in ask mode', async () => {
    let asked = false;
    const gate = new PermissionGate({
      mode: 'ask',
      sandboxMode: 'workspace-write',
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
    const gate = new PermissionGate({ mode: 'auto', sandboxMode: 'read' });
    const result = await gate.allow('Write', 'write', { file_path: 'a.ts' });
    expect(result.allowed).toBe(false);
  });
});

