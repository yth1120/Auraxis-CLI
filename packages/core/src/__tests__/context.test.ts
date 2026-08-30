import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compactMessages, estimateChatTokens, estimateTokens, summarizeMessages } from '../context.js';
import { MemoryStore } from '../memory.js';
import type { LlmClient, LlmRequest, LlmResult } from '../types.js';

describe('context and memory', () => {
  it('estimates tokens and compacts large tool output', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
    const input = [
      { role: 'system' as const, content: 'system' },
      { role: 'tool' as const, name: 'Read', tool_call_id: '1', content: 'x'.repeat(20_000) },
    ];
    const compacted = compactMessages(input, 1_000);
    expect(compacted[1]?.content).toContain('已压缩的历史工具输出');
    expect(estimateChatTokens(input)).toBeGreaterThan(estimateChatTokens(compacted));
  });

  it('summarizes messages once when context is over budget', async () => {
    const llm: LlmClient = {
      async chat(_request: LlmRequest): Promise<LlmResult> {
        return { content: '摘要：完成了一个任务', reasoning: '', toolCalls: [] };
      },
    };
    const summarized = await summarizeMessages(
      llm,
      [
        { role: 'system', content: '你是 Auraxis' },
        { role: 'user', content: '原始问题' },
        { role: 'assistant', content: '开始处理' },
      ],
      '/tmp/project',
    );
    expect(summarized.summary).toContain('完成了一个任务');
    expect(summarized.messages.at(-1)?.role).toBe('user');
  });

  it('remembers and searches project memory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-memory-'));
    try {
      const store = MemoryStore.project(root);
      const record = await store.remember('约定', '使用 pnpm 而不是 npm', ['project']);
      const found = await store.search('pnpm');
      expect(found).toHaveLength(1);
      expect(found[0].id).toBe(record.id);
      expect(found[0].content).toContain('pnpm');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
