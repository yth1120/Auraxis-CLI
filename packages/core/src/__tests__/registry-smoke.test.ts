import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getTool,
  getTools,
  isToolConcurrencySafe,
  isToolReadOnly,
  summarizeToolInput,
  type ToolContext,
} from '../tools/registry.js';

function context(): ToolContext {
  return {
    projectRoot: process.cwd(),
    sessionId: 'registry-smoke',
    emit: () => {},
    todos: [],
    setTodos: () => {},
  } as ToolContext;
}

describe('registered code mode tool surface', () => {
  it('exposes code mode tools with concurrency metadata and summaries', () => {
    const names = getTools().map((tool) => tool.name);
    for (const name of ['RunCode', 'RunWorkflow', 'TaskOutput', 'TaskStop', 'TaskList', 'JobList', 'Pty', 'TerminalOpen', 'NotebookEdit', 'Delete', 'Replan']) {
      expect(names).toContain(name);
      expect(getTool(name)).toBeDefined();
    }
    expect(isToolConcurrencySafe('TaskOutput')).toBe(true);
    expect(isToolConcurrencySafe('TaskStop')).toBe(false);
    expect(isToolConcurrencySafe('RunCode')).toBe(false);
    expect(isToolReadOnly('Read')).toBe(true);
    expect(isToolReadOnly('RunCode')).toBe(false);
    expect(summarizeToolInput('RunCode', { language: 'javascript' })).toBe('javascript');
    expect(summarizeToolInput('RunWorkflow', { name: 'wf' })).toBe('wf');
    expect(summarizeToolInput('NotebookEdit', { file_path: 'a.ipynb' })).toBe('a.ipynb');
    expect(summarizeToolInput('Delete', { file_path: 'a.ts' })).toBe('a.ts');
  });

  it('runs background Bash through the registered runner', async () => {
    const started = await getTool('Bash')!.runner(
      { command: 'node -e "console.log(\'registry-bg\')"', run_in_background: true },
      context(),
    );
    const payload = JSON.parse(started.content) as { task_id: string };
    expect(payload.task_id).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const output = await getTool('TaskOutput')!.runner({ task_id: payload.task_id }, context());
    expect(output.content).toContain('registry-bg');
    await getTool('TaskStop')!.runner({ task_id: payload.task_id }, context());
  });

  it('routes terminal and job aliases through the registered runners', async () => {
    const ctx = context();
    await getTool('TerminalOpen')!.runner({ session_id: 'reg-pty', command: process.execPath }, ctx);
    await getTool('TerminalRead')!.runner({ session_id: 'missing' }, ctx);
    await getTool('TerminalSend')!.runner({ session_id: 'missing', data: 'x' }, ctx);
    await getTool('TerminalSignal')!.runner({ session_id: 'missing', signal: 'SIGINT' }, ctx);
    await getTool('TerminalClose')!.runner({ session_id: 'reg-pty' }, ctx);
    await getTool('JobOutput')!.runner({ job_id: 'missing' }, ctx);
    await getTool('JobKill')!.runner({ job_id: 'missing' }, ctx);
    await getTool('TaskList')!.runner({}, ctx);
    await getTool('JobList')!.runner({}, ctx);
  });

  it('covers plugin discovery and symbol lookup edge branches', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-symbol-empty-'));
    try {
      const plugins = await getTool('PluginManage')!.runner({ action: 'discover' }, { ...context(), projectRoot: root });
      expect(plugins.content).toContain('AURAXIS_PLUGIN_MARKETPLACE');
      const symbol = await getTool('FindSymbol')!.runner({ symbol: 'not-here', limit: 3 }, { ...context(), projectRoot: root });
      expect(symbol.content).toContain('未找到匹配符号');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('covers inspect, agent error, plugin list and symbol found branches', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-registry-branches-'));
    const oldTrust = process.env.AURAXIS_TRUST_PROJECT_HOOKS;
    process.env.AURAXIS_TRUST_PROJECT_HOOKS = '1';
    try {
      await fs.mkdir(path.join(root, '.auraxis', 'plugins', 'demo'), { recursive: true });
      await fs.writeFile(
        path.join(root, '.auraxis', 'plugins', 'demo', 'plugin.json'),
        JSON.stringify({ id: 'demo', name: 'Demo', version: '1.0.0', skills: ['x'] }),
        'utf8',
      );
      await fs.writeFile(path.join(root, 'a.ts'), 'export function foo() { return 1; }\n', 'utf8');
      const ctx = { ...context(), projectRoot: root };
      expect((await getTool('InspectRuntime')!.runner({}, ctx)).content).toContain('projectRoot');
      const agent = await getTool('Agent')!.runner(
        { prompt: 'x', description: 'd' },
        { ...ctx, runSubAgent: async () => { throw new Error('agent boom'); } },
      );
      expect(agent.content).toContain('agent boom');
      const plugins = await getTool('PluginManage')!.runner({ action: 'list' }, ctx);
      expect(plugins.content).toContain('demo');
      const symbol = await getTool('FindSymbol')!.runner({ symbol: 'foo', limit: 3 }, ctx);
      expect(symbol.content).toContain('foo');
    } finally {
      if (oldTrust === undefined) delete process.env.AURAXIS_TRUST_PROJECT_HOOKS;
      else process.env.AURAXIS_TRUST_PROJECT_HOOKS = oldTrust;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
