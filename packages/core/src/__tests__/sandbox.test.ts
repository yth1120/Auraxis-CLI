import { describe, expect, it } from 'vitest';
import { SandboxPolicy } from '../sandbox.js';

describe('sandbox policy', () => {
  it('rejects paths outside project and dangerous commands', () => {
    const sandbox = new SandboxPolicy({ mode: 'workspace-write', projectRoot: '/project' });
    expect(() => sandbox.assertPath('/outside')).toThrow();
    expect(() => sandbox.assertCommand('rm -rf /')).toThrow();
    expect(sandbox.wrapCommand('echo hi')).toBe('echo hi');
  });

  it('blocks network access in read mode', () => {
    const sandbox = new SandboxPolicy({ mode: 'read', projectRoot: '/project' });
    expect(() => sandbox.assertNetwork('https://example.com')).toThrow();
  });

  it('requires a container runner in container mode', () => {
    const previous = process.env.AURAXIS_CONTAINER_RUNNER;
    delete process.env.AURAXIS_CONTAINER_RUNNER;
    try {
      const sandbox = new SandboxPolicy({ mode: 'container', projectRoot: '/project' });
      expect(() => sandbox.assertCommand('echo hi')).not.toThrow();
      expect(sandbox.wrapCommand('echo hi')).toContain('docker run');
    } finally {
      if (previous) process.env.AURAXIS_CONTAINER_RUNNER = previous;
    }
  });
});
