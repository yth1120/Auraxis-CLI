import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, runAgent } from '../engine/agent.js';
import { runHook } from '../hooks.js';
import { getTools } from '../tools/registry.js';
import type { ToolContext } from '../tools/registry.js';
import { chatMessageText, type ChatMessage, type LlmClient, type LlmRequest, type LlmResult, type McpHost } from '../types.js';

class FinalLlm implements LlmClient {
  async chat(request: LlmRequest): Promise<LlmResult> {
    return {
      content: request.messages.at(-1)?.role === 'user' ? '<FINAL_ANSWER>done' : 'done',
      reasoning: '',
      toolCalls: [],
    };
  }
}

async function writeHook(root: string, name: string, source: string): Promise<string> {
  const file = path.join(root, `${name}.mjs`);
  await fs.writeFile(file, source, 'utf8');
  return `${JSON.stringify(process.execPath)} ${JSON.stringify(file)}`;
}

async function withTempProject(): Promise<{ root: string; home: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-agent-branches-'));
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-agent-branches-home-'));
  return { root, home };
}

async function cleanup(root: string, home: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(home, { recursive: true, force: true });
}

describe('agent branch flows', () => {
  it('blocks a user prompt from a hook', async () => {
    const { root, home } = await withTempProject();
    const previous = process.env.AURAXIS_HOME;
    process.env.AURAXIS_HOME = home;
    try {
      await fs.mkdir(path.join(home, 'config'), { recursive: true });
      const command = await writeHook(home, 'block-prompt', `console.log(JSON.stringify({ continue: false, additionalContext: 'blocked' }));`);
      await fs.writeFile(
        path.join(home, 'config', 'hooks.json'),
        JSON.stringify({ hooks: { user_prompt_submit: { command } } }),
        'utf8',
      );
      const events: string[] = [];
      const result = await runAgent({
        prompt: 'hello',
        projectRoot: root,
        model: 'm',
        apiKey: 'k',
        apiBase: 'https://example.invalid',
        mode: 'auto',
        sandboxMode: 'read',
        tools: [],
        llm: new FinalLlm(),
        sessionId: 's-block',
        onEvent: (event) => events.push(event.type),
      });
      expect(result.text).toBe('');
      expect(result.iterations).toBe(0);
      expect(events).toContain('system_message');
    } finally {
      await cleanup(root, home);
      if (previous === undefined) delete process.env.AURAXIS_HOME;
      else process.env.AURAXIS_HOME = previous;
    }
  });

  it('emits stop hook context and plan rejection/edit branches', async () => {
    const { root, home } = await withTempProject();
    const previousHome = process.env.AURAXIS_HOME;
    process.env.AURAXIS_HOME = home;
    try {
      await fs.mkdir(path.join(home, 'config'), { recursive: true });
      const stop = await writeHook(home, 'stop', `console.log(JSON.stringify({ stopReason: 'stop-it', additionalContext: 'hook-context' }));`);
      await fs.writeFile(path.join(home, 'config', 'hooks.json'), JSON.stringify({ hooks: { stop: { command: stop } } }), 'utf8');
      const events: string[] = [];
      const result = await runAgent({
        prompt: 'hello',
        projectRoot: root,
        model: 'm',
        apiKey: 'k',
        apiBase: 'https://example.invalid',
        mode: 'auto',
        sandboxMode: 'read',
        tools: [],
        llm: new FinalLlm(),
        sessionId: 's-stop',
        onEvent: (event) => events.push(event.type),
      });
      expect(result.text).toBe('done');
      expect(events).toContain('system_message');

      const planLlm: LlmClient = {
        async chat(request: LlmRequest): Promise<LlmResult> {
          return request.responseFormat === 'json_object'
            ? { content: JSON.stringify({ tasks: [{ id: '1', description: 'task' }] }), reasoning: '', toolCalls: [] }
            : { content: '<FINAL_ANSWER>done', reasoning: '', toolCalls: [] };
        },
      };
      const rejected = await runAgent({
        prompt: 'plan',
        projectRoot: root,
        model: 'm',
        apiKey: 'k',
        apiBase: 'https://example.invalid',
        mode: 'plan',
        sandboxMode: 'read',
        tools: [],
        llm: planLlm,
        sessionId: 's-plan-reject',
      });
      expect(rejected.plan?.tasks).toHaveLength(1);
      expect(rejected.iterations).toBe(0);

      const edited = await runAgent({
        prompt: 'plan',
        projectRoot: root,
        model: 'm',
        apiKey: 'k',
        apiBase: 'https://example.invalid',
        mode: 'plan',
        sandboxMode: 'read',
        tools: [],
        llm: planLlm,
        sessionId: 's-plan-edit',
        onPlanApproval: async () => 'edit',
        onPlanEdit: async () => null,
      });
      expect(edited.plan?.tasks[0]?.description).toBe('task');
    } finally {
      await cleanup(root, home);
      if (previousHome === undefined) delete process.env.AURAXIS_HOME;
      else process.env.AURAXIS_HOME = previousHome;
    }
  });

  it('aborts before an iteration and supports MCP tools', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-agent-mcp-'));
    const controller = new AbortController();
    controller.abort();
    const result = await runAgent({
      prompt: 'stop',
      projectRoot: root,
      model: 'm',
      apiKey: 'k',
      apiBase: 'https://example.invalid',
      mode: 'auto',
      sandboxMode: 'read',
      tools: [],
      llm: new FinalLlm(),
      sessionId: 's-abort',
      signal: controller.signal,
    });
    expect(result.aborted).toBe(true);

    let calls = 0;
    const mcpLlm: LlmClient = {
      async chat(): Promise<LlmResult> {
        calls += 1;
        return calls === 1
          ? { content: '', reasoning: '', toolCalls: [{ id: 'm1', name: 'mcp__demo__echo', args: { text: 'x' } }] }
          : { content: '<FINAL_ANSWER>mcp-done', reasoning: '', toolCalls: [] };
      },
    };
    const mcp: McpHost = {
      getToolDefinitions: () => [],
      hasTool: () => false,
      getDefinition: () => ({ name: 'mcp__demo__echo', description: 'echo', danger: 'mcp', parameters: { type: 'object' }, mcpServer: 'demo' }),
      call: async () => 'mcp-output',
      close: async () => {},
    };
    const events: string[] = [];
    await runAgent({
      prompt: 'use mcp',
      projectRoot: root,
      model: 'm',
      apiKey: 'k',
      apiBase: 'https://example.invalid',
      mode: 'auto',
      sandboxMode: 'workspace-write',
      tools: [],
      mcp,
      llm: mcpLlm,
      sessionId: 's-mcp',
      onEvent: (event) => events.push(event.type),
    });
    expect(events).toContain('tool_end');
    await fs.rm(root, { recursive: true, force: true });
  });

  it('builds system prompts with and without rules', () => {
    expect(buildSystemPrompt('/p', [], '')).toContain('编码智能体');
    expect(buildSystemPrompt('/p', [], 'rule')).toContain('项目规则');
  });

  it('records plan generation failures and session hook context', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-agent-plan-error-'));
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-agent-hook-context-'));
    const previous = process.env.AURAXIS_HOME;
    process.env.AURAXIS_HOME = home;
    try {
      const failing: LlmClient = {
        async chat(): Promise<LlmResult> {
          throw new Error('plan generation failed');
        },
      };
      const events: string[] = [];
      const result = await runAgent({
        prompt: 'plan',
        projectRoot: root,
        model: 'm',
        apiKey: 'k',
        apiBase: 'https://example.invalid',
        mode: 'plan',
        sandboxMode: 'read',
        tools: [],
        llm: failing,
        sessionId: 's-plan-fail',
        onEvent: (event) => events.push(event.type),
      });
      expect(result.plan).toBeNull();
      expect(events).toContain('error');

      await fs.mkdir(path.join(home, 'config'), { recursive: true });
      const hook = await writeHook(home, 'start-context', `console.log(JSON.stringify({ additionalContext: 'hello-hook' }));`);
      await fs.writeFile(
        path.join(home, 'config', 'hooks.json'),
        JSON.stringify({ hooks: { session_start: { command: hook } } }),
        'utf8',
      );
      const captured: ChatMessage[][] = [];
      const capture: LlmClient = {
        async chat(request: LlmRequest): Promise<LlmResult> {
          captured.push(request.messages);
          return { content: '<FINAL_ANSWER>ok', reasoning: '', toolCalls: [] };
        },
      };
      await runAgent({
        prompt: 'hello',
        projectRoot: root,
        model: 'm',
        apiKey: 'k',
        apiBase: 'https://example.invalid',
        mode: 'auto',
        sandboxMode: 'read',
        tools: [],
        llm: capture,
        sessionId: 's-start-context',
      });
      expect(captured[0]?.some((message) => chatMessageText(message.content).includes('hello-hook'))).toBe(true);
    } finally {
      await cleanup(root, home);
      if (previous === undefined) delete process.env.AURAXIS_HOME;
      else process.env.AURAXIS_HOME = previous;
    }
  });

  it('passes image artifacts to vision models and limits sub-agent depth', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-agent-image-'));
    try {
      const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8ff3f0004010001a815f00000000049454e44ae426082', 'hex');
      await fs.writeFile(path.join(root, 'pixel.png'), png);
      let imageLlmCalls = 0;
      const imageLlm: LlmClient = {
        async chat(): Promise<LlmResult> {
          imageLlmCalls += 1;
          return imageLlmCalls === 1
            ? { content: '', reasoning: '', toolCalls: [{ id: 'img', name: 'ReadImage', args: { file_path: 'pixel.png' } }] }
            : { content: '<FINAL_ANSWER>image-done', reasoning: '', toolCalls: [] };
        },
      };
      const imageResult = await runAgent({
        prompt: 'read image',
        projectRoot: root,
        model: 'vision-model',
        apiKey: 'k',
        apiBase: 'https://example.invalid',
        mode: 'auto',
        sandboxMode: 'workspace-write',
        tools: getTools(),
        llm: imageLlm,
        sessionId: 's-image',
      });
      expect(imageResult.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'))).toBe(true);

      let depthCalls = 0;
      const depthLlm: LlmClient = {
        async chat(): Promise<LlmResult> {
          depthCalls += 1;
          return depthCalls === 1
            ? { content: '', reasoning: '', toolCalls: [{ id: 'depth', name: 'CustomAgent', args: { prompt: 'sub' } }] }
            : { content: '<FINAL_ANSWER>depth-done', reasoning: '', toolCalls: [] };
        },
      };
      const depthEvents: string[] = [];
      const depthResult = await runAgent({
        prompt: 'parent',
        projectRoot: root,
        model: 'm',
        apiKey: 'k',
        apiBase: 'https://example.invalid',
        mode: 'auto',
        sandboxMode: 'read',
        tools: [
          {
            name: 'CustomAgent',
            description: 'custom agent',
            danger: 'agent',
            parameters: { type: 'object', properties: {} },
            runner: async (_input: unknown, ctx: ToolContext) => {
              await ctx.runSubAgent?.('sub');
              return { content: 'ok' };
            },
          } as never,
        ],
        llm: depthLlm,
        sessionId: 's-depth',
        subAgentDepth: 2,
        onEvent: (event) => depthEvents.push(event.type),
      });
      expect(depthResult.text).toBe('depth-done');
      expect(depthEvents).toContain('tool_error');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('runs session_end hooks after the agent finishes', async () => {
    const { root, home } = await withTempProject();
    const previous = process.env.AURAXIS_HOME;
    process.env.AURAXIS_HOME = home;
    try {
      await fs.mkdir(path.join(home, 'config'), { recursive: true });
      const marker = path.join(root, 'session-end.marker');
      const hook = await writeHook(home, 'end', `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, '1');`);
      await fs.writeFile(path.join(home, 'config', 'hooks.json'), JSON.stringify({ hooks: { session_end: { command: hook } } }), 'utf8');
      const direct = await runHook({ command: hook }, {}, root);
      expect(direct.ok).toBe(true);
      await expect(fs.stat(marker)).resolves.toMatchObject({});
      await fs.rm(marker, { force: true });
      await runAgent({
        prompt: 'done',
        projectRoot: root,
        model: 'm',
        apiKey: 'k',
        apiBase: 'https://example.invalid',
        mode: 'auto',
        sandboxMode: 'read',
        tools: [],
        llm: new FinalLlm(),
        sessionId: 's-session-end',
      });
      await expect(fs.stat(marker)).resolves.toMatchObject({});
    } finally {
      await cleanup(root, home);
      if (previous === undefined) delete process.env.AURAXIS_HOME;
      else process.env.AURAXIS_HOME = previous;
    }
  });
});
