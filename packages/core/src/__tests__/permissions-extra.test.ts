import { describe, expect, it } from 'vitest';
import { PermissionGate } from '../engine/permissions.js';

describe('PermissionGate decisions', () => {
  it('allows auto mode and remembers session/rule decisions', async () => {
    const auto = new PermissionGate({ mode: 'auto', sandboxMode: 'workspace-write', projectRoot: '/project' });
    expect((await auto.allow('Write', 'write', { file_path: 'a.ts' })).allowed).toBe(true);

    const ask = new PermissionGate({
      mode: 'ask',
      sandboxMode: 'workspace-write',
      projectRoot: '/project',
      requestPermission: async () => 'allow_session',
    });
    expect((await ask.allow('Write', 'write', { file_path: 'same.ts' })).allowed).toBe(true);
    expect((await ask.allow('Write', 'write', { file_path: 'same.ts' })).decision).toBe('allow_session');

    const rule = new PermissionGate({
      mode: 'ask',
      sandboxMode: 'workspace-write',
      projectRoot: '/project',
      requestPermission: async () => 'allow_rule',
    });
    expect((await rule.allow('Bash', 'exec', { command: 'npm test' })).allowed).toBe(true);
  });

  it('denies unknown decisions and does not ask read-only tools in plan mode', async () => {
    const gate = new PermissionGate({
      mode: 'plan',
      sandboxMode: 'workspace-write',
      projectRoot: '/project',
      requestPermission: async () => 'show_error' as never,
    });
    expect((await gate.allow('Read', 'read', { file_path: 'a.ts' })).allowed).toBe(true);
    expect((await gate.allow('Write', 'write', { file_path: 'a.ts' })).allowed).toBe(false);
  });

  it('allows internal tools in read sandbox and rejects exec', async () => {
    const read = new PermissionGate({ mode: 'auto', sandboxMode: 'read', projectRoot: '/project' });
    expect((await read.allow('TodoWrite', 'internal', { todos: [] })).allowed).toBe(true);
    expect((await read.allow('Bash', 'exec', { command: 'echo' })).allowed).toBe(false);
  });
});
