import { describe, expect, it } from 'vitest';
import { generatePlan } from '../engine/planner.js';
import type { LlmClient, LlmRequest, LlmResult } from '../types.js';

class PlanLlm implements LlmClient {
  async chat(request: LlmRequest): Promise<LlmResult> {
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
});

