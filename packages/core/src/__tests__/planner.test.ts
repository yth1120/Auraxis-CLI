import { describe, expect, it } from 'vitest';
import { generatePlan } from '../engine/planner.js';
import type { LlmClient, LlmRequest, LlmResult } from '../types.js';

class PlanLlm implements LlmClient {
  async chat(_request: LlmRequest): Promise<LlmResult> {
    return {
      content: JSON.stringify({
        summary: '修复登录流程',
        tasks: [
          { id: '1', description: '检查登录 gate', dependencies: [] },
          { id: '2', description: '修复 userData', dependencies: ['1'] },
        ],
      }),
      reasoning: '',
      toolCalls: [],
    };
  }
}

describe('generatePlan', () => {
  it('parses a structured plan', async () => {
    const plan = await generatePlan(new PlanLlm(), '修复登录', '/tmp/project');
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0].description).toContain('登录');
    expect(plan.tasks[1].dependencies).toContain('1');
  });

  it('falls back for fenced empty or malformed plans', async () => {
    const empty = await generatePlan(
      { chat: async () => ({ content: '```json\n{"tasks":[]}\n```', reasoning: '', toolCalls: [] }) },
      'do it',
      '/p',
    );
    expect(empty.tasks[0]?.description).toBe('do it');
  });

  it('falls back when tasks is not an array', async () => {
    const malformed = await generatePlan(
      { chat: async () => ({ content: '{"tasks":"bad","summary":"x"}', reasoning: '', toolCalls: [] }) },
      'other',
      '/p',
    );
    expect(malformed.tasks[0]?.description).toBe('other');
  });
});
