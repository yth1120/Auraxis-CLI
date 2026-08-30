import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCodeTool, runTaskTool, runWorkflowTool } from '../code-tools.js';
import { getTool, getTools, type ToolContext } from '../tools/registry.js';

process.env.AURAXIS_ALLOW_UNSAFE_CODE = '1';

afterEach(() => vi.unstubAllGlobals());

function context(partial: Partial<ToolContext> = {}): ToolContext {
  return {
    projectRoot: process.cwd(),
    sessionId: 'test',
    emit: () => {},
    todos: [],
    setTodos: () => {},
    ...partial,
  } as ToolContext;
}

describe('code tools', () => {
  it('runs plain JavaScript through RunCode', async () => {
    const result = await runCodeTool(
      { language: 'javascript', code: 'console.log("tool-ok")' },
      context(),
    );
    expect(result.content).toContain('tool-ok');
  });

  it('fails closed for inline RunWorkflow when arbitrary code is disabled', async () => {
    const old = process.env.AURAXIS_ALLOW_UNSAFE_CODE;
    delete process.env.AURAXIS_ALLOW_UNSAFE_CODE;
    try {
      const result = await runWorkflowTool({ script: 'return 1;' }, context());
      expect(result.content).toContain('默认禁用');
    } finally {
      if (old === undefined) delete process.env.AURAXIS_ALLOW_UNSAFE_CODE;
      else process.env.AURAXIS_ALLOW_UNSAFE_CODE = old;
    }
  });

  it('runs TypeScript orchestration through the permission-aware executor', async () => {
    const calls: string[] = [];
    const result = await runCodeTool(
      {
        language: 'typescript',
        code: "const r = await tools.Echo({ text: 'hello' }); return r.text;",
      },
      context({
        executeTool: async (name, input) => {
          calls.push(name);
          return { output: { text: String(input.text) } };
        },
      }),
    );
    expect(result.content).toContain('hello');
    expect(calls).toEqual(['Echo']);
  });

  it('runs inline workflows with a transcript', async () => {
    const result = await runWorkflowTool(
      { script: "ctx.log('step'); return { ok: true };" },
      context({ runSubAgent: async () => 'ok' }),
    );
    expect(result.content).toContain('"ok": true');
    expect(result.content).toContain('step');
  });

  it('reports invalid code inputs and unavailable orchestration', async () => {
    await expect(runCodeTool({ language: 'ruby', code: 'x' }, context())).rejects.toThrow('不支持的运行语言');
    await expect(runCodeTool({ language: 'javascript', code: '   ' }, context())).rejects.toThrow('code 不能为空');
    await expect(runCodeTool({ language: 'typescript', code: 'const x: = 1' }, context())).rejects.toThrow();
    await expect(runCodeTool({ language: 'typescript', code: 'return 1' }, context())).rejects.toThrow('不支持');
  });

  it('surfaces worker and workflow script errors', async () => {
    const codeFailure = await runCodeTool(
      { language: 'typescript', code: "throw new Error('code-wf-boom')" },
      context({ executeTool: async () => ({ output: null }) }),
    );
    expect(codeFailure.content).toContain('code-wf-boom');
    const workflowFailure = await runWorkflowTool({ script: "throw new Error('wf-boom')" }, context());
    expect(workflowFailure.content).toContain('wf-boom');
    const noPrompt = await runWorkflowTool(
      { script: "return await ctx.agents.run({});" },
      context({ runSubAgent: async () => 'unused' }),
    );
    expect(noPrompt.content).toContain('prompt 不能为空');
  });

  it('reports missing workflows, empty agent prompts and abort behavior', async () => {
    const missing = await runWorkflowTool({ name: 'missing' }, context());
    expect(missing.content).toContain('未找到工作流');
    const aborted = new AbortController();
    aborted.abort();
    const cancelled = await runWorkflowTool(
      { script: 'return 1;' },
      context({ signal: aborted.signal, runSubAgent: async () => 'ok' }),
    );
    expect(cancelled.content).toContain('被取消');
  });

  it('supports workflow agents, missing sub-agents and oversized scripts', async () => {
    const viaAgent = await runWorkflowTool(
      { script: "return await ctx.agents.run({ prompt: 'child', description: 'child' });" },
      context({ runSubAgent: async (prompt) => `child:${prompt}` }),
    );
    expect(viaAgent.content).toContain('child:child');
    const wfRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-wf-tool-'));
    await fs.mkdir(path.join(wfRoot, '.auraxis', 'workflows'), { recursive: true });
    await fs.writeFile(
      path.join(wfRoot, '.auraxis', 'workflows', 'x.json'),
      JSON.stringify({ id: 'x', name: 'x', steps: [{ id: 'a', name: 'A', prompt: 'a' }] }),
      'utf8',
    );
    const noSubagent = await runWorkflowTool({ name: 'x' }, context({ projectRoot: wfRoot }));
    expect(noSubagent.content).toContain('不支持');
    const withSubagent = await runWorkflowTool(
      { name: 'x' },
      context({ projectRoot: wfRoot, runSubAgent: async () => 'wf-child-result' }),
    );
    expect(withSubagent.content).toContain('wf-child-result');
    const oversized = await runWorkflowTool({ script: 'x'.repeat(60_001) }, context());
    expect(oversized.content).toContain('脚本过长');
    await fs.rm(wfRoot, { recursive: true, force: true });
  });

  it('reports unknown task actions', async () => {
    const result = await runTaskTool({ action: 'unknown' }, context());
    expect(result.content).toContain('unknown task action');
  });

  it('lists and stops background tasks through aliases', async () => {
    const listed = await runTaskTool({ action: 'list' }, context());
    expect(JSON.parse(listed.content)).toBeInstanceOf(Array);
    const missing = await runTaskTool({ action: 'output', task_id: 'none' }, context());
    expect(missing.content).toContain('后台任务不存在');
    const stopped = await runTaskTool({ action: 'stop', task_id: 'none' }, context());
    expect(JSON.parse(stopped.content)).toMatchObject({ ok: false });
  });

  it('registers the new code mode tools and runners', async () => {
    const names = getTools().map((tool) => tool.name);
    for (const name of ['RunCode', 'RunWorkflow', 'TaskOutput', 'TaskStop', 'TaskList', 'Pty', 'TerminalOpen', 'NotebookEdit']) {
      expect(names).toContain(name);
      expect(getTool(name)).toBeDefined();
    }

    const run = (name: string, input: Record<string, unknown>) => getTool(name)!.runner(input as never, context());
    expect(JSON.parse((await run('TaskList', {})).content)).toBeInstanceOf(Array);
    expect(await run('Pty', { action: 'create', session_id: 'p1', command: 'node' })).toMatchObject({});
    expect(await run('TerminalList', {})).toMatchObject({});
    expect(await run('TerminalClose', { session_id: 'missing' })).toMatchObject({});
  });
});
