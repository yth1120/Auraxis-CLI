import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionMailbox } from '../mailbox.js';
import { listArtifacts, publishArtifact } from '../artifacts.js';

describe('collaboration tools', () => {
  it('sends and reads cross-session messages', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-mailbox-'));
    const previous = process.env.AURAXIS_HOME;
    process.env.AURAXIS_HOME = root;
    try {
      const mailbox = SessionMailbox.global();
      await mailbox.send('session-a', 'session-b', '测试消息');
      const messages = await mailbox.list('session-b');
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('测试消息');
    } finally {
      if (previous === undefined) delete process.env.AURAXIS_HOME;
      else process.env.AURAXIS_HOME = previous;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('publishes and lists project artifacts', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-artifact-'));
    try {
      const file = await publishArtifact(root, '审查报告', '## 结论\n通过');
      expect(file).toContain(path.join('.auraxis', 'artifacts'));
      expect(await listArtifacts(root)).toHaveLength(1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
