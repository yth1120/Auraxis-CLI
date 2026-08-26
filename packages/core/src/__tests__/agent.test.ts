import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAgent } from '../engine/agent.js';
import { getTools } from '../tools/registry.js';
import type { LlmClient, LlmRequest, LlmResult } from '../types.js';

class FakeLlm implements LlmClient {
  calls = 0;

  async chat(request: LlmRequest): Promise<LlmResult> {
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

  it('runs a nested subagent through the Agent tool', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-subagent-'));
    class SubAgentLlm implements LlmClient {
      calls = 0;
      async chat(request: LlmRequest): Promise<LlmResult> {
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
});
