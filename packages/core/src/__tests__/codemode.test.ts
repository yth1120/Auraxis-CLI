import { describe, expect, it } from 'vitest';
import { runCodeProgram, type CodeModeExecuteResult, type CodeModeHost } from '../codemode.js';

process.env.AURAXIS_ALLOW_UNSAFE_CODE = '1';

function host(executeTool: CodeModeHost['executeTool'], signal?: AbortSignal): CodeModeHost {
  return { projectRoot: process.cwd(), requestId: 'codemode-test', executeTool, signal };
}

const ok = (output: unknown): CodeModeExecuteResult => ({ output });

describe('runCodeProgram', () => {
  it('runs a program, injects tools, returns print output and sub-call trace', async () => {
    const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
    const result = await runCodeProgram(
      ['const r = await tools.Ping({ q: 1 });', "console.log('got', r.content);"].join('\n'),
      host(async (name, input) => {
        calls.push({ name, input });
        return ok({ content: 'pong' });
      }),
      { timeoutMs: 10_000 },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('got pong');
    expect(calls[0]).toMatchObject({ name: 'Ping', input: { q: 1 } });
    expect(result.subCalls[0]).toMatchObject({ name: 'Ping', status: 'done' });
    expect(result.subCalls[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('surfaces tool errors as a worker failure with stderr', async () => {
    const result = await runCodeProgram(
      'const r = await tools.Bad({});',
      host(async () => ({ output: null, error: 'tool boom' })),
      { timeoutMs: 10_000 },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('tool boom');
    expect(result.subCalls[0]).toMatchObject({ name: 'Bad', status: 'error' });
  });

  it('terminates a blocking program on timeout', async () => {
    const result = await runCodeProgram('while (true) {}', host(async () => ok(null)), { timeoutMs: 100 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it('aborts and terminates on signal', async () => {
    const controller = new AbortController();
    const pending = runCodeProgram(
      'await tools.Slow({});',
      host(async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return ok(null);
      }, controller.signal),
      { timeoutMs: 30_000 },
    );
    setTimeout(() => controller.abort(), 50);
    const result = await pending;
    expect(result.aborted).toBe(true);
    expect(result.exitCode).toBeNull();
  });

  it('rejects empty and oversized programs', async () => {
    const empty = await runCodeProgram('', host(async () => ok(null)));
    expect(empty.exitCode).toBe(1);
    expect(empty.stderr).toContain('不能为空');
    const oversized = await runCodeProgram('x'.repeat(200_001), host(async () => ok(null)));
    expect(oversized.exitCode).toBe(1);
    expect(oversized.stderr).toContain('限制');
  });

  it('caps oversized tool inputs without hanging', async () => {
    const name = 'Big';
    const result = await runCodeProgram(
      `await tools.${name}({ data: '${'x'.repeat(100_001)}' })`,
      host(async () => ok(null)),
      { timeoutMs: 5_000 },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('工具输入超过');
  });

  it('limits concurrent sub-calls to the configured maximum', async () => {
    let active = 0;
    let maxActive = 0;
    const calls = Array.from({ length: 20 }, (_, index) => `tools.Job${index}({})`).join(', ');
    const result = await runCodeProgram(
      `await Promise.all([${calls}]);`,
      host(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return ok({ v: 1 });
      }),
      { timeoutMs: 30_000 },
    );
    expect(result.exitCode).toBe(0);
    expect(maxActive).toBeLessThanOrEqual(8);
  });

  it('reports uncaught worker exceptions', async () => {
    const result = await runCodeProgram('throw new Error("boom");', host(async () => ok(null)), { timeoutMs: 5_000 });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('boom');
  });

  it('captures thrown executor errors and marks sub-calls as failed', async () => {
    const result = await runCodeProgram(
      "try { await tools.Fail({}); } catch (e) { return 'caught:' + e.message; }",
      host(async () => {
        throw new Error('executor boom');
      }),
      { timeoutMs: 5_000 },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('executor boom');
    expect(result.subCalls[0]).toMatchObject({ name: 'Fail', status: 'error' });
  });

  it('rejects invalid TypeScript syntax before starting the worker', async () => {
    await expect(
      runCodeProgram('const value: = 1;', host(async () => ok(null)), { timeoutMs: 5_000 }),
    ).rejects.toThrow(/语法错误/);
  });

  it('fails closed when arbitrary code execution is disabled', async () => {
    const old = process.env.AURAXIS_ALLOW_UNSAFE_CODE;
    delete process.env.AURAXIS_ALLOW_UNSAFE_CODE;
    try {
      const result = await runCodeProgram('return 1', host(async () => ok(null)), { timeoutMs: 5_000 });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('默认禁用');
    } finally {
      if (old === undefined) delete process.env.AURAXIS_ALLOW_UNSAFE_CODE;
      else process.env.AURAXIS_ALLOW_UNSAFE_CODE = old;
    }
  });

  it('emits lifecycle events and honors an already-aborted signal', async () => {
    const events: string[] = [];
    await runCodeProgram(
      "console.log('line'); await tools.Ping({});",
      {
        projectRoot: process.cwd(),
        requestId: 'events',
        onEvent: (event) => events.push(event.type),
        executeTool: async () => ok({ content: 'ok' }),
      },
      { timeoutMs: 5_000 },
    );
    expect(events).toEqual([
      'code_start',
      'code_log',
      'code_tool_start',
      'code_tool_end',
      'code_done',
    ]);

    const controller = new AbortController();
    controller.abort();
    const aborted = await runCodeProgram(
      'await tools.Slow({});',
      host(async () => ok(null), controller.signal),
      { timeoutMs: 5_000 },
    );
    expect(aborted.aborted).toBe(true);
  });

  it('uses an explicit executeTool override and safe default options', async () => {
    let received = '';
    const result = await runCodeProgram(
      'await tools.Hello({ value: "x" });',
      {
        projectRoot: process.cwd(),
        requestId: 'override',
        executeTool: async () => ok({ v: 1 }),
      },
      {
        executeTool: async (name, input) => {
          received = `${name}:${input.value}`;
          return ok(null);
        },
        timeoutMs: 0,
        outputCap: 0,
      },
    );
    expect(received).toBe('Hello:x');
    expect(result.exitCode).toBe(0);
  });

  it('truncates output when the program exceeds the cap', async () => {
    const result = await runCodeProgram(
      `console.log('${'x'.repeat(60_000)}');`,
      host(async () => ok(null)),
      { outputCap: 1_000, timeoutMs: 10_000 },
    );
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(1_000);
  });
});
