import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverMarketplace, installPlugin, scanPlugins } from '../plugins.js';
import { loadMemoryContext, MemoryStore } from '../memory.js';
import { todoWriteTool } from '../tools/todo.js';
import { generatePlan } from '../engine/planner.js';
import type { ToolContext, ToolOutput } from '../tools/registry.js';
import type { LlmClient, LlmResult } from '../types.js';

let home = '';
let project = '';

afterEach(async () => {
  delete process.env.AURAXIS_PLUGIN_MARKETPLACE;
  delete process.env.AURAXIS_HOME;
  if (home) await fs.rm(home, { recursive: true, force: true });
  if (project) await fs.rm(project, { recursive: true, force: true });
});

async function temp(): Promise<{ home: string; project: string }> {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-plugin-home-'));
  project = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-plugin-project-'));
  process.env.AURAXIS_HOME = home;
  return { home, project };
}

describe('plugins and memory', () => {
  it('installs and discovers marketplace plugins', async () => {
    const { project } = await temp();
    const source = path.join(project, 'source-plugin');
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, 'plugin.json'), JSON.stringify({ id: 'p', name: 'P', version: '1.0.0' }), 'utf8');
    const installed = await installPlugin(source, project);
    expect(installed.manifest.id).toBe('p');

    const marketplace = path.join(home, 'marketplace.json');
    await fs.writeFile(marketplace, JSON.stringify([{ id: 'm1', name: 'M1' }, { id: 'bad' }]), 'utf8');
    process.env.AURAXIS_PLUGIN_MARKETPLACE = marketplace;
    expect((await discoverMarketplace()).map((plugin) => plugin.id)).toEqual(['m1']);

    await fs.writeFile(marketplace, '{bad', 'utf8');
    expect(await discoverMarketplace()).toEqual([]);
  });

  it('respects project plugin trust settings', async () => {
    const { project } = await temp();
    const dir = path.join(project, '.auraxis', 'plugins', 'p');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'plugin.json'), JSON.stringify({ id: 'p', name: 'P' }), 'utf8');
    const before = await scanPlugins(project, false);
    const after = await scanPlugins(project, true);
    expect(before).toHaveLength(0);
    expect(after).toHaveLength(1);
  });

  it('skips invalid plugin manifests', async () => {
    const { project } = await temp();
    const dir = path.join(project, '.auraxis', 'plugins', 'bad');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'plugin.json'), '{bad', 'utf8');
    expect(await scanPlugins(project, true)).toHaveLength(0);
  });

  it('persists memories and searches by keyword', async () => {
    const { project } = await temp();
    const store = new MemoryStore(path.join(project, '.auraxis', 'memory.json'));
    expect(await loadMemoryContext(project, 10)).toBe('');
    await store.remember('Title', 'content');
    await store.remember('Other', 'different');
    expect((await store.search('title')).map((record) => record.title)).toEqual(['Title']);
    expect((await store.load()).length).toBe(2);
    expect(await loadMemoryContext(project, 10)).toContain('Title');
    expect((await loadMemoryContext(project, 1)).split('\n').length).toBeGreaterThan(0);
    await store.remember('Dup', 'same', ['a', 'a']);
    expect(await store.search('dup')).toHaveLength(1);
  });

  it('ignores missing plugin roots and corrupt memory files', async () => {
    const { project } = await temp();
    expect(await scanPlugins(project, true)).toEqual([]);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-memory-corrupt-'));
    const store = new MemoryStore(path.join(root, 'memory.json'));
    await store.remember('T', 'C');
    await fs.writeFile(path.join(root, 'memory.json'), '{bad', 'utf8');
    expect(await store.load()).toEqual([]);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('filters malformed memory records and renders tags', async () => {
    await temp();
    const store = new MemoryStore(path.join(home, 'memory.json'));
    await fs.writeFile(
      path.join(home, 'memory.json'),
      JSON.stringify([
        { id: 'good', title: 'Title', content: 'Content', tags: ['x'], updatedAt: 2 },
        { id: 'bad' },
      ]),
      'utf8',
    );
    expect((await store.load()).map((record) => record.id)).toEqual(['good']);
    expect(await loadMemoryContext(project, 10)).toContain('[x]');
  });
});

describe('todo and planner fallback', () => {
  it('normalizes todo dependencies', async () => {
    let next: unknown[] = [];
    const ctx: ToolContext = { projectRoot: '/p', emit: () => {}, todos: [], setTodos: (v) => (next = v) };
    const result: ToolOutput = await todoWriteTool(
      { todos: [{ id: '1', description: 'a', status: 'running', dependencies: ['cleanup'] }] },
      ctx,
    );
    expect(result.content).toContain('0/1');
    expect(next).toHaveLength(1);
  });

  it('falls back when plan JSON is invalid', async () => {
    const llm: LlmClient = {
      async chat(): Promise<LlmResult> {
        return { content: 'not json', reasoning: '', toolCalls: [] };
      },
    };
    const plan = await generatePlan(llm, 'hello', '/project');
    expect(plan.tasks[0]?.description).toBe('hello');
  });
});
