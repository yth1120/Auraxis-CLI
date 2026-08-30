import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findWorkflow, listWorkflows, parseMarkdownWorkflow, renderTemplate, runWorkflow, topoOrder } from '../workflow.js';

describe('workflow engine', () => {
  it('parses markdown and orders dependency-free steps', () => {
    const workflow = parseMarkdownWorkflow(
      '---\nname: Demo\n---\n## 1. Read\nread the project\n## 2. Test\nrun tests',
      'fallback',
    );
    expect(workflow?.name).toBe('Demo');
    expect(workflow?.steps).toHaveLength(2);
    expect(topoOrder(workflow!)).toHaveLength(2);
  });

  it('renders results and runs steps through a runner', async () => {
    const workflow = {
      id: 'wf',
      name: 'WF',
      steps: [
        { id: 'a', name: 'A', prompt: 'first {{b.result}}', dependsOn: ['b'] },
        { id: 'b', name: 'B', prompt: 'second' },
      ],
    };
    const calls: string[] = [];
    const result = await runWorkflow(workflow, {
      runSubAgent: async (prompt) => {
        calls.push(prompt);
        return prompt.includes('second') ? 'b-result' : 'a-result';
      },
    });
    expect(result.ok).toBe(true);
    expect(result.results.b).toBe('b-result');
    expect(result.results.a).toBe('a-result');
    expect(renderTemplate('x {{a.result}}', { a: 'ok' })).toBe('x ok');
  });

  it('detects cycles, unknown dependencies and blocked steps', async () => {
    const cyclic = {
      id: 'cycle',
      name: 'Cycle',
      steps: [
        { id: 'a', name: 'A', prompt: 'a', dependsOn: ['b'] },
        { id: 'b', name: 'B', prompt: 'b', dependsOn: ['a'] },
      ],
    };
    expect(() => topoOrder(cyclic)).toThrow('循环');
    const broken = {
      id: 'broken',
      name: 'Broken',
      steps: [{ id: 'a', name: 'A', prompt: 'a', dependsOn: ['missing'] }],
    };
    expect(() => topoOrder(broken)).toThrow('未知依赖');
    const blocked = {
      id: 'blocked',
      name: 'Blocked',
      steps: [
        { id: 'a', name: 'A', prompt: 'a', dependsOn: ['b'] },
        { id: 'b', name: 'B', prompt: 'b' },
      ],
    };
    const result = await runWorkflow(blocked, {
      runSubAgent: async () => {
        throw new Error('step failed');
      },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.b).toContain('step failed');
  });

  it('loads JSON workflow definitions and handles malformed markdown', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-wf-home-'));
    process.env.AURAXIS_HOME = home;
    try {
      const dir = path.join(home, 'config', 'workflows');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'demo.json'),
        JSON.stringify({ id: 'demo', name: 'Demo', steps: [{ id: 'a', name: 'A', prompt: 'a' }] }),
        'utf8',
      );
      expect(await listWorkflows()).toHaveLength(1);
      expect(await findWorkflow(process.cwd(), 'demo')).toMatchObject({ id: 'demo' });
      expect(parseMarkdownWorkflow('no sections', 'x')).toBeNull();
      expect(renderTemplate('x {{missing.result}}', {})).toContain('missing');
      await fs.writeFile(path.join(dir, 'bad.json'), '{bad', 'utf8');
      await fs.writeFile(path.join(dir, 'no-id.json'), JSON.stringify({ steps: [] }), 'utf8');
      await fs.writeFile(path.join(dir, 'ignore.txt'), 'not a workflow', 'utf8');
      expect(await listWorkflows()).toHaveLength(1);
      expect(await findWorkflow(process.cwd(), 'missing')).toBeNull();
      expect(() =>
        topoOrder({
          id: 'dup',
          name: 'dup',
          steps: [
            { id: 'a', name: 'A', prompt: 'a' },
            { id: 'a', name: 'A2', prompt: 'a2' },
          ],
        }),
      ).toThrow('重复');
      expect(parseMarkdownWorkflow('---\nname: Empty\n---\nno sections', 'x')).toBeNull();
      expect(parseMarkdownWorkflow('---\nname: A\ndescription: B\n---\n## No body', 'x')).toBeNull();
      const stringError = await runWorkflow(
        { id: 'str', name: 'str', steps: [{ id: 'a', name: 'A', prompt: 'a' }] },
        {
          runSubAgent: async () => {
            throw 'string failure';
          },
        },
      );
      expect(stringError.errors.a).toContain('string failure');
    } finally {
      delete process.env.AURAXIS_HOME;
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});
