import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadHooks, runHook, runHooksFor } from '../hooks.js';

async function writeHook(root: string, name: string, source: string): Promise<string> {
  const file = path.join(root, `${name}.mjs`);
  await fs.writeFile(file, source, 'utf8');
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(file)}`;
}

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-hooks-home-'));
  const previous = process.env.AURAXIS_HOME;
  process.env.AURAXIS_HOME = home;
  try {
    return await fn(home);
  } finally {
    if (previous === undefined) delete process.env.AURAXIS_HOME;
    else process.env.AURAXIS_HOME = previous;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await fs.rm(home, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 9) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }
}

describe('hooks', () => {
  it('loads global and optional project hooks in order', async () => {
    await withTempHome(async (home) => {
      const project = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-hooks-project-'));
      try {
        await fs.mkdir(path.join(home, 'config'), { recursive: true });
        await fs.writeFile(
          path.join(home, 'config', 'hooks.json'),
          JSON.stringify({ hooks: { pre_tool_use: { command: 'echo global' } } }),
          'utf8',
        );
        await fs.mkdir(path.join(project, '.auraxis'), { recursive: true });
        await fs.writeFile(
          path.join(project, '.auraxis', 'hooks.json'),
          JSON.stringify({ hooks: { pre_tool_use: [{ command: 'echo project-1' }, { command: 'echo project-2' }] } }),
          'utf8',
        );
        await fs.mkdir(path.join(home, 'plugins', 'p1'), { recursive: true });
        await fs.writeFile(
          path.join(home, 'plugins', 'p1', 'plugin.json'),
          JSON.stringify({ id: 'p1', name: 'P1', hooks: { pre_tool_use: { command: 'echo plugin-1' } } }),
          'utf8',
        );

        const untrusted = await loadHooks(project);
        expect(untrusted.pre_tool_use?.length).toBe(2);

        const previousTrust = process.env.AURAXIS_TRUST_PROJECT_HOOKS;
        process.env.AURAXIS_TRUST_PROJECT_HOOKS = '1';
        try {
          const trusted = await loadHooks(project);
          expect(trusted.pre_tool_use?.map((item) => item.command)).toEqual([
            'echo global',
            'echo project-1',
            'echo project-2',
            'echo plugin-1',
          ]);
        } finally {
          if (previousTrust === undefined) delete process.env.AURAXIS_TRUST_PROJECT_HOOKS;
          else process.env.AURAXIS_TRUST_PROJECT_HOOKS = previousTrust;
        }
      } finally {
        await fs.rm(project, { recursive: true, force: true });
      }
    });
  });

  it('blocks pre-tool-use on protocol decision or non-zero exit', async () => {
    await withTempHome(async (home) => {
      const project = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-hooks-block-'));
      try {
        const blocked = await writeHook(home, 'blocked', `console.log(JSON.stringify({ decision: 'block', stopReason: 'deny' }));`);
        const failed = await writeHook(home, 'failed', 'process.exit(3);');
        const blockedDispatch = await runHooksFor('pre_tool_use', { toolName: 'Write', input: {} }, project, {
          pre_tool_use: [{ command: blocked }],
        });
        const failedDispatch = await runHooksFor('pre_tool_use', { toolName: 'Bash', input: {} }, project, {
          pre_tool_use: [{ command: failed }],
        });
        expect(blockedDispatch.blocked).toBe(true);
        expect(blockedDispatch.stopReason).toBe('deny');
        expect(failedDispatch.blocked).toBe(true);
      } finally {
        await fs.rm(project, { recursive: true, force: true });
      }
    });
  });

  it('blocks user input when continue is false', async () => {
    await withTempHome(async (home) => {
      const project = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-hooks-prompt-'));
      try {
        const command = await writeHook(home, 'prompt', `console.log(JSON.stringify({ continue: false, additionalContext: 'stop' }));`);
        const dispatch = await runHooksFor('user_prompt_submit', { prompt: 'hi' }, project, {
          user_prompt_submit: [{ command }],
        });
        expect(dispatch.blocked).toBe(true);
        expect(dispatch.additionalContext).toBe('stop');
      } finally {
        await fs.rm(project, { recursive: true, force: true });
      }
    });
  });

  it('reports timeouts instead of hanging forever', async () => {
    await withTempHome(async (home) => {
      const project = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-hooks-timeout-'));
      try {
        const command = await writeHook(home, 'slow', 'setTimeout(() => {}, 5000);');
        const result = await runHook({ command, timeout: 80 }, {}, project);
        expect(result.timedOut).toBe(true);
        expect(result.ok).toBe(false);
      } finally {
        await fs.rm(project, { recursive: true, force: true });
      }
    });
  });

  it('parses protocol fields and does not leak credential env vars', async () => {
    await withTempHome(async (home) => {
      const project = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-hooks-secret-'));
      const previous = process.env.HOOK_TEST_SECRET;
      process.env.HOOK_TEST_SECRET = 'should-not-leak';
      try {
        const command = await writeHook(
          home,
          'secret',
          `console.log(JSON.stringify({ leaked: Boolean(process.env.HOOK_TEST_SECRET), hasPayload: Boolean(process.env.HOOK_PAYLOAD) }));`,
        );
        const result = await runHook({ command }, { prompt: 'hello' }, project);
        expect(result.ok).toBe(true);
        const parsed = JSON.parse(result.output) as { leaked?: boolean; hasPayload?: boolean };
        expect(parsed.leaked).toBe(false);
        expect(parsed.hasPayload).toBe(true);
      } finally {
        if (previous === undefined) delete process.env.HOOK_TEST_SECRET;
        else process.env.HOOK_TEST_SECRET = previous;
        await fs.rm(project, { recursive: true, force: true });
      }
    });
  });

  it('ignores malformed hook files and treats plain output as successful', async () => {
    await withTempHome(async (home) => {
      await fs.mkdir(path.join(home, 'config'), { recursive: true });
      await fs.writeFile(path.join(home, 'config', 'hooks.json'), '{bad', 'utf8');
      expect(await loadHooks()).toEqual({});
      const result = await runHook({ command: 'echo plain' }, {}, home);
      expect(result.ok).toBe(true);
      expect(result.protocol).toBeUndefined();
    });
  });
});
