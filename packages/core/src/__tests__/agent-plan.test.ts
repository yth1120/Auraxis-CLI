import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAgent } from '../engine/agent.js';
import { getTools } from '../tools/registry.js';
import type { LlmClient, LlmRequest, LlmResult } from '../types.js';

class PlanLlm implements LlmClient {
  private calls = 0;
  constructor(private readonly decision: 'approve' | 'reject' | 'edit') {}

  async chat(request: LlmRequest): Promise<LlmResult> {
    this.calls += 1;
    if (request.responseFormat === 'json_object') {
      return {
        content: JSON.stringify({ summary: 'plan', tasks: [{ id: '1', description: 'task' }] }),
        reasoning: '',
        toolCalls: [],
      };
    }
    return { content: this.decision === 'approve' ? '<FINAL_ANSWER>done' : 'done', reasoning: '', toolCalls: [] };
  }
}

describe('plan mode agent flows', () => {
  it('approves and executes a generated plan', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-plan-'));
    const result = await runAgent({
      prompt: 'do it',
      projectRoot: root,
      model: 'm',
      apiKey: 'k',
      apiBase: 'https://example.invalid',
      mode: 'plan',
      sandboxMode: 'read',
      tools: [],
      llm: new PlanLlm('approve'),
      sessionId: 's-plan',
      onPlanApproval: async () => 'approve',
    });
    expect(result.plan?.tasks).toHaveLength(1);
    expect(result.text).toBe('done');
  });

  it('rejects a plan without executing tools', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-plan-reject-'));
    const result = await runAgent({
      prompt: 'do it',
      projectRoot: root,
      model: 'm',
      apiKey: 'k',
      apiBase: 'https://example.invalid',
      mode: 'plan',
      sandboxMode: 'read',
      tools: [],
      llm: new PlanLlm('reject'),
      sessionId: 's-reject',
      onPlanApproval: async () => 'reject',
    });
    expect(result.plan?.tasks).toHaveLength(1);
    expect(result.text).toBe('');
    expect(result.iterations).toBe(0);
  });

  it('edits a plan when requested', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-plan-edit-'));
    const result = await runAgent({
      prompt: 'do it',
      projectRoot: root,
      model: 'm',
      apiKey: 'k',
      apiBase: 'https://example.invalid',
      mode: 'plan',
      sandboxMode: 'read',
      tools: [],
      llm: new PlanLlm('edit'),
      sessionId: 's-edit',
      onPlanApproval: async () => 'edit',
      onPlanEdit: async () => ({ tasks: [{ id: '2', description: 'edited', status: 'pending' }] }),
    });
    expect(result.plan?.tasks[0]?.description).toBe('edited');
  });
});

describe('agent error handling', () => {
  it('reports unknown tools and tool runtime errors', async () => {
    let calls = 0;
    const llm: LlmClient = {
      async chat(): Promise<LlmResult> {
        calls += 1;
        if (calls === 1) {
          return {
            content: '',
            reasoning: '',
            toolCalls: [
              { id: 'unknown', name: 'MissingTool', args: { x: 1 } },
              { id: 'broken', name: 'Broken', args: {} },
            ],
          };
        }
        return { content: '<FINAL_ANSWER>done', reasoning: '', toolCalls: [] };
      },
    };
    const events: string[] = [];
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-errors-'));
    const result = await runAgent({
      prompt: 'test',
      projectRoot: root,
      model: 'm',
      apiKey: 'k',
      apiBase: 'https://example.invalid',
      mode: 'auto',
      sandboxMode: 'read',
      tools: [
        {
          name: 'Broken',
          description: 'broken',
          danger: 'read',
          parameters: { type: 'object', properties: {} },
          runner: async () => {
            throw new Error('boom');
          },
        },
      ] as never,
      llm,
      sessionId: 's-errors',
      onEvent: (event) => events.push(event.type),
    });
    expect(result.text).toBe('done');
    expect(events).toContain('tool_error');
    expect(result.messages.filter((message) => message.role === 'tool')).toHaveLength(2);
  });
});

describe('Replan integration', () => {
  it('regenerates a plan when the model requests it', async () => {
    let calls = 0;
    const llm: LlmClient = {
      async chat(request: LlmRequest): Promise<LlmResult> {
        calls += 1;
        if (request.responseFormat === 'json_object') {
          return {
            content: JSON.stringify({ summary: 'replanned', tasks: [{ id: 'r1', description: 'rerun' }] }),
            reasoning: '',
            toolCalls: [],
          };
        }
        if (calls === 1) {
          return {
            content: '',
            reasoning: '',
            toolCalls: [{ id: 'rp1', name: 'Replan', args: { reason: 'blocked' } }],
          };
        }
        return { content: '<FINAL_ANSWER>done', reasoning: '', toolCalls: [] };
      },
    };
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-replan-'));
    try {
      const events: string[] = [];
      const result = await runAgent({
        prompt: 'do it',
        projectRoot: root,
        model: 'm',
        apiKey: 'k',
        apiBase: 'https://example.invalid',
        mode: 'auto',
        sandboxMode: 'read',
        tools: getTools(),
        llm,
        sessionId: 's-replan',
        onEvent: (event) => events.push(event.type),
      });
      expect(result.text).toBe('done');
      expect(events).toContain('plan_updated');
      expect(result.messages.find((message) => message.role === 'tool')?.content).toContain('r1');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('reports a replan failure without crashing the loop', async () => {
    let calls = 0;
    const llm: LlmClient = {
      async chat(request: LlmRequest): Promise<LlmResult> {
        calls += 1;
        if (request.responseFormat === 'json_object') throw new Error('planner unavailable');
        if (calls === 1) {
          return {
            content: '',
            reasoning: '',
            toolCalls: [{ id: 'rp2', name: 'Replan', args: { reason: 'blocked' } }],
          };
        }
        return { content: '<FINAL_ANSWER>continued', reasoning: '', toolCalls: [] };
      },
    };
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-replan-error-'));
    try {
      const result = await runAgent({
        prompt: 'do it',
        projectRoot: root,
        model: 'm',
        apiKey: 'k',
        apiBase: 'https://example.invalid',
        mode: 'auto',
        sandboxMode: 'read',
        tools: getTools(),
        llm,
        sessionId: 's-replan-error',
      });
      expect(result.text).toBe('continued');
      expect(result.messages.find((message) => message.role === 'tool')?.content).toContain('planner unavailable');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
