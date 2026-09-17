import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAgent } from '../engine/agent.js';
import { getTools } from '../tools/registry.js';
import { chatMessageText, type LlmClient, type LlmRequest, type LlmResult } from '../types.js';

process.env.AURAXIS_ALLOW_UNSAFE_CODE = '1';

class FakeLlm implements LlmClient {
  calls = 0;

  async chat(_request: LlmRequest): Promise<LlmResult> {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        content: '',
        reasoning: '',
        toolCalls: [
          {
            id: 'call_1',
            name: 'Write',
            args: { file_path: 'out.txt', content: 'hello from agent' },
          },
        ],
      };
    }
    return { content: '<FINAL_ANSWER>done', reasoning: '', toolCalls: [] };
  }
}

class LoopingLlm implements LlmClient {
  calls = 0;
  finalRequest?: LlmRequest;

  async chat(request: LlmRequest): Promise<LlmResult> {
    this.calls += 1;
    if (request.toolChoice === 'none' || request.tools?.length === 0) {
      this.finalRequest = request;
      return { content: '<FINAL_ANSWER>fallback summary', reasoning: '', toolCalls: [] };
    }
    return {
      content: '',
      reasoning: '',
      toolCalls: [{ id: `call_${this.calls}`, name: 'InspectRuntime', args: {} }],
    };
  }
}

describe('runAgent', () => {
  it('executes tools and finishes with assistant text', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-agent-'));
    const llm = new FakeLlm();
    const events: string[] = [];
    const result = await runAgent({
      prompt: 'write out.txt',
      projectRoot: root,
      model: 'deepseek-v4-pro',
      apiKey: 'test',
      apiBase: 'https://example.invalid',
      mode: 'auto',
      sandboxMode: 'workspace-write',
      tools: getTools(),
      llm,
      sessionId: 's-test',
      onEvent: (event) => events.push(event.type),
    });
    expect(result.text).toBe('done');
    expect(result.toolCallCount).toBe(1);
    expect(result.iterations).toBe(2);
    expect(await fs.readFile(path.join(root, 'out.txt'), 'utf8')).toBe('hello from agent');
    expect(events).toContain('tool_start');
    expect(events).toContain('tool_end');
  });

  it('forces a final summary when the tool iteration budget is exhausted', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-agent-limit-'));
    const llm = new LoopingLlm();
    const events: string[] = [];
    const result = await runAgent({
      prompt: 'keep working',
      projectRoot: root,
      model: 'deepseek-v4-flash',
      apiKey: 'test',
      apiBase: 'https://example.invalid',
      mode: 'auto',
      sandboxMode: 'workspace-write',
      tools: getTools(),
      llm,
      sessionId: 's-limit',
      maxSteps: 2,
      onEvent: (event) => events.push(event.type),
    });

    expect(result.text).toBe('fallback summary');
    expect(result.iterations).toBe(2);
    expect(result.steps).toBe(2);
    expect(result.stopReason).toBe('max_steps');
    expect(result.toolCallCount).toBe(2);
    expect(llm.finalRequest?.toolChoice).toBe('none');
    expect(llm.finalRequest?.tools).toEqual([]);
    expect(events).toContain('system_message');
    expect(events).toContain('done');
  });

  it('stops repeated identical tool rounds with unchanged results', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-agent-loop-'));
    const llm = new LoopingLlm();
    const events: string[] = [];
    const result = await runAgent({
      prompt: 'loop forever',
      projectRoot: root,
      model: 'deepseek-v4-flash',
      apiKey: 'test',
      apiBase: 'https://example.invalid',
      mode: 'auto',
      sandboxMode: 'workspace-write',
      tools: getTools(),
      llm,
      sessionId: 's-loop',
      maxSteps: 10,
      onEvent: (event) => events.push(event.type),
    });

    expect(result.text).toBe('fallback summary');
    expect(result.steps).toBe(3);
    expect(result.toolCallCount).toBe(3);
    expect(result.stopReason).toBe('loop_detected');
    expect(events).toContain('system_message');
    expect(events).toContain('done');
  });

  it('returns denied permission without executing a risky tool', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-denied-'));
    const llm = new FakeLlm();
    const result = await runAgent({
      prompt: 'write out.txt',
      projectRoot: root,
      model: 'deepseek-v4-pro',
      apiKey: 'test',
      apiBase: 'https://example.invalid',
      mode: 'ask',
      sandboxMode: 'workspace-write',
      tools: getTools(),
      llm,
      sessionId: 's-test',
      requestPermission: async () => 'deny',
    });
    expect(result.toolCallCount).toBe(1);
    expect(result.text).toBe('done');
    await expect(fs.stat(path.join(root, 'out.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('blocks a tool before execution when pre_tool_use hook denies it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-hook-agent-'));
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-hook-agent-home-'));
    const previousHome = process.env.AURAXIS_HOME;
    process.env.AURAXIS_HOME = dataDir;
    try {
      await fs.mkdir(path.join(dataDir, 'config'), { recursive: true });
      const hookFile = path.join(dataDir, 'deny-tool.mjs');
      await fs.writeFile(hookFile, `console.log(JSON.stringify({ decision: 'block', stopReason: 'policy' }));`, 'utf8');
      await fs.writeFile(
        path.join(dataDir, 'config', 'hooks.json'),
        JSON.stringify({
          hooks: {
            pre_tool_use: {
              command: `${JSON.stringify(process.execPath)} ${JSON.stringify(hookFile)}`,
            },
          },
        }),
        'utf8',
      );
      const events: string[] = [];
      const result = await runAgent({
        prompt: 'write out.txt',
        projectRoot: root,
        model: 'deepseek-v4-pro',
        apiKey: 'test',
        apiBase: 'https://example.invalid',
        mode: 'auto',
        sandboxMode: 'workspace-write',
        tools: getTools(),
        llm: new FakeLlm(),
        sessionId: 's-hook',
        onEvent: (event) => events.push(event.type),
      });
      expect(result.text).toBe('done');
      expect(result.toolCallCount).toBe(1);
      expect(events).toContain('tool_error');
      expect(events).not.toContain('tool_end');
      await expect(fs.stat(path.join(root, 'out.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
      const toolMessage = result.messages.find((message) => message.role === 'tool');
      expect(toolMessage?.content).toContain('Hook 阻止执行 Write');
    } finally {
      if (previousHome === undefined) delete process.env.AURAXIS_HOME;
      else process.env.AURAXIS_HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });

  it('runs a nested subagent through the Agent tool', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-subagent-'));
    class SubAgentLlm implements LlmClient {
      calls = 0;
      async chat(_request: LlmRequest): Promise<LlmResult> {
        this.calls += 1;
        if (this.calls === 1) {
          return {
            content: '',
            reasoning: '',
            toolCalls: [{ id: 'call-agent', name: 'Agent', args: { prompt: '完成子任务', description: 'test subagent' } }],
          };
        }
        if (this.calls === 2) return { content: '<FINAL_ANSWER>子任务完成', reasoning: '', toolCalls: [] };
        return { content: '<FINAL_ANSWER>父任务完成', reasoning: '', toolCalls: [] };
      }
    }
    const events: string[] = [];
    const result = await runAgent({
      prompt: '执行父任务',
      projectRoot: root,
      model: 'deepseek-v4-pro',
      apiKey: 'test',
      apiBase: 'https://example.invalid',
      mode: 'auto',
      sandboxMode: 'workspace-write',
      tools: getTools(),
      llm: new SubAgentLlm(),
      sessionId: 's-parent',
      onEvent: (event) => events.push(event.type),
    });
    expect(result.text).toBe('父任务完成');
    expect(result.toolCallCount).toBe(1);
    expect(events).toContain('system_message');
  });

  it('runs parallel subagents through the SpawnAgents tool', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-parallel-agent-'));
    class ParallelLlm implements LlmClient {
      async chat(request: LlmRequest): Promise<LlmResult> {
        const prompt = chatMessageText(request.messages.at(-1)?.content);
        if (request.messages.at(-1)?.role === 'user' && prompt.includes('任务 A')) return { content: '子任务 A 完成', reasoning: '', toolCalls: [] };
        if (request.messages.at(-1)?.role === 'user' && prompt.includes('任务 B')) return { content: '子任务 B 完成', reasoning: '', toolCalls: [] };
        if (request.messages.at(-1)?.role === 'user' && prompt.includes('并行父任务')) {
          return {
            content: '',
            reasoning: '',
            toolCalls: [
              {
                id: 'spawn-1',
                name: 'SpawnAgents',
                args: {
                  tasks: [
                    { prompt: '任务 A', description: 'A' },
                    { prompt: '任务 B', description: 'B' },
                  ],
                },
              },
            ],
          };
        }
        return { content: '<FINAL_ANSWER>父任务完成', reasoning: '', toolCalls: [] };
      }
    }
    const result = await runAgent({
      prompt: '并行父任务',
      projectRoot: root,
      model: 'deepseek-v4-pro',
      apiKey: 'test',
      apiBase: 'https://example.invalid',
      mode: 'auto',
      sandboxMode: 'workspace-write',
      tools: getTools(),
      llm: new ParallelLlm(),
      sessionId: 's-parallel',
    });
    expect(result.text).toBe('父任务完成');
    expect(result.toolCallCount).toBe(1);
    expect(result.messages.some((message) => chatMessageText(message.content).includes('子任务 A 完成'))).toBe(true);
    expect(result.messages.some((message) => chatMessageText(message.content).includes('子任务 B 完成'))).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('replaces a stale system prompt when resuming a session', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-resume-system-'));
    let prompt = '';
    const llm: LlmClient = {
      async chat(request: LlmRequest): Promise<LlmResult> {
        prompt = chatMessageText(request.messages[0]?.content);
        return { content: '<FINAL_ANSWER>ok', reasoning: '', toolCalls: [] };
      },
    };
    await runAgent({
      prompt: '继续',
      projectRoot: root,
      model: 'deepseek-v4-pro',
      apiKey: 'test',
      apiBase: 'https://example.invalid',
      mode: 'auto',
      sandboxMode: 'read',
      tools: getTools(),
      llm,
      sessionId: 's-resume',
      resumeMessages: [
        { role: 'system', content: '旧系统提示' },
        { role: 'user', content: '旧问题' },
      ],
    });
    expect(prompt).toContain('编码智能体');
  });

  it('passes runtime tools to the model', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-tool-specs-'));
    let specs: Array<{ name: string }> = [];
    const llm: LlmClient = {
      async chat(request: LlmRequest): Promise<LlmResult> {
        specs = request.tools || [];
        return { content: '<FINAL_ANSWER>ok', reasoning: '', toolCalls: [] };
      },
    };
    await runAgent({
      prompt: 'do it',
      projectRoot: root,
      model: 'deepseek-v4-pro',
      apiKey: 'test',
      apiBase: 'https://example.invalid',
      mode: 'auto',
      sandboxMode: 'read',
      tools: [
        ...getTools(),
        {
          name: 'DynamicTool',
          description: 'runtime tool',
          danger: 'read',
          parameters: { type: 'object', properties: {} },
        },
      ],
      llm,
      sessionId: 's-tools',
    });
    expect(specs.map((spec) => spec.name)).toContain('DynamicTool');
    expect(specs.map((spec) => spec.name)).toContain('Read');
  });

  it('injects layered AGENTS.md rules into the system prompt', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-rules-'));
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-rules-home-'));
    const previousHome = process.env.AURAXIS_HOME;
    process.env.AURAXIS_HOME = dataDir;
    await fs.writeFile(path.join(root, 'AGENTS.md'), '禁止删除 README.md', 'utf8');
    let system = '';
    try {
      class RuleLlm implements LlmClient {
        async chat(request: LlmRequest): Promise<LlmResult> {
          system = chatMessageText(request.messages[0].content);
          return { content: '<FINAL_ANSWER>ok', reasoning: '', toolCalls: [] };
        }
      }
      await runAgent({
        prompt: 'read README',
        projectRoot: root,
        model: 'deepseek-v4-pro',
        apiKey: 'test',
        apiBase: 'https://example.invalid',
        mode: 'auto',
        sandboxMode: 'workspace-write',
        tools: getTools(),
        llm: new RuleLlm(),
        sessionId: 's-rules',
      });
      expect(system).toContain('禁止删除 README.md');
      expect(system).toContain('项目规则');
    } finally {
      if (previousHome === undefined) delete process.env.AURAXIS_HOME;
      else process.env.AURAXIS_HOME = previousHome;
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });
});

describe('Code Mode inside Agent', () => {
  it('executes a TypeScript orchestration program through the full tool gate', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-code-agent-'));
    await fs.writeFile(path.join(root, 'README.md'), '# hello', 'utf8');
    let calls = 0;
    const llm: LlmClient = {
      async chat(): Promise<LlmResult> {
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            reasoning: '',
            toolCalls: [
              {
                id: 'code1',
                name: 'RunCode',
                args: {
                  language: 'typescript',
                  code: "const r = await tools.Read({ file_path: 'README.md' }); return r;",
                },
              },
            ],
          };
        }
        return { content: '<FINAL_ANSWER>code-agent-ok', reasoning: '', toolCalls: [] };
      },
    };
    const result = await runAgent({
      prompt: 'write code',
      projectRoot: root,
      model: 'm',
      apiKey: 'k',
      apiBase: 'https://example.invalid',
      mode: 'auto',
      sandboxMode: 'workspace-write',
      tools: getTools(),
      llm,
      sessionId: 's-code-agent',
    });
    expect(result.text).toBe('code-agent-ok');
    expect(result.messages.find((message) => message.role === 'tool' && message.name === 'RunCode')?.content).toContain('hello');
    await fs.rm(root, { recursive: true, force: true });
  });

  it('denies a Code Mode sub-call through the normal permission gate', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-code-deny-'));
    let calls = 0;
    const llm: LlmClient = {
      async chat(): Promise<LlmResult> {
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            reasoning: '',
            toolCalls: [
              {
                id: 'code2',
                name: 'RunCode',
                args: {
                  language: 'typescript',
                  code: "await tools.Write({ file_path: 'deny.txt', content: 'x' }); return 'ok';",
                },
              },
            ],
          };
        }
        return { content: '<FINAL_ANSWER>denied', reasoning: '', toolCalls: [] };
      },
    };
    const result = await runAgent({
      prompt: 'write code',
      projectRoot: root,
      model: 'm',
      apiKey: 'k',
      apiBase: 'https://example.invalid',
      mode: 'ask',
      sandboxMode: 'workspace-write',
      tools: getTools(),
      llm,
      sessionId: 's-code-deny',
      requestPermission: async (request) => (request.tool === 'Write' ? 'deny' : 'allow_once'),
    });
    expect(result.text).toBe('denied');
    expect(result.messages.map((message) => chatMessageText(message.content)).join('\n')).toContain('拒绝');
    await fs.rm(root, { recursive: true, force: true });
  });
});
