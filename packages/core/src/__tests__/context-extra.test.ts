import { describe, expect, it } from 'vitest';
import { compactMessages, estimateChatTokens, estimateTokens, summarizeMessages } from '../context.js';
import type { ChatMessage, LlmClient, LlmResult } from '../types.js';

describe('context compaction', () => {
  it('compacts oversized tool payloads and preserves system/user messages', () => {
    const messages: ChatMessage[] = [
      { role: 'system' as const, content: 'system' },
      { role: 'user' as const, content: 'q' },
      { role: 'tool' as const, tool_call_id: 't', name: 'Bash', content: JSON.stringify({ ok: true, output: 'x'.repeat(5000) }) },
    ];
    const result = compactMessages(messages, 10);
    expect(result[0]).toMatchObject({ role: 'system' });
    expect(result.at(-1)?.content).toContain('已压缩');
  });

  it('summarizes messages and keeps the latest user prompt', async () => {
    const llm: LlmClient = {
      async chat(): Promise<LlmResult> {
        return { content: 'summary', reasoning: '', toolCalls: [] };
      },
    };
    const result = await summarizeMessages(
      llm,
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'latest' },
      ],
      '/project',
    );
    expect(result.summary).toBe('summary');
    expect(result.messages.at(-1)?.content).toContain('latest');
  });

  it('returns unchanged messages when no latest user exists', async () => {
    const messages: ChatMessage[] = [{ role: 'system', content: 'sys' }];
    const result = await summarizeMessages({ chat: async () => ({ content: 'x', reasoning: '', toolCalls: [] }) }, messages, '/p');
    expect(result.messages).toEqual(messages);
  });

  it('estimates token counts', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('hello')).toBeGreaterThan(0);
    expect(estimateTokens('你好')).toBeGreaterThan(0);
    expect(estimateChatTokens([{ role: 'user', content: 'hi' }])).toBe(estimateTokens('hi'));
  });

  it('handles image content and error tool payloads', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,x' } }] },
      { role: 'tool', tool_call_id: 't', name: 'Bash', content: JSON.stringify({ ok: false, error: 'bad' }) },
    ];
    const result = compactMessages(messages, 100);
    expect(result).toHaveLength(3);
    expect(result.at(-1)?.content).toContain('bad');
  });

  it('uses a fallback summary when no latest user exists', async () => {
    const result = await summarizeMessages(
      { chat: async () => ({ content: 'fallback', reasoning: '', toolCalls: [] }) },
      [{ role: 'user', content: 'only' }] as ChatMessage[],
      '/p',
    );
    expect(result.summary).toBe('fallback');
  });

  it('compacts tool payloads even when it fits the budget', () => {
    const result = compactMessages(
      [
        { role: 'user', content: 'q' },
        { role: 'tool', tool_call_id: 't', name: 'Read', content: JSON.stringify({ ok: true, output: 'x'.repeat(10_000) }) },
      ],
      10_000,
    );
    expect(result.at(-1)?.content).toContain('截断');
  });

  it('uses placeholder text for image/latest user content in summaries', async () => {
    const result = await summarizeMessages(
      { chat: async () => ({ content: 'summary', reasoning: '', toolCalls: [] }) },
      [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
      '/p',
    );
    expect(result.summary).toBe('summary');
    expect(result.messages.at(-1)?.content).toBe('[用户消息]');
  });

  it('handles structured system content during summaries', async () => {
    const result = await summarizeMessages(
      { chat: async () => ({ content: 'summary', reasoning: '', toolCalls: [] }) },
      [
        { role: 'system', content: [{ type: 'text', text: 'sys' }] },
        { role: 'user', content: 'latest' },
      ],
      '/p',
    );
    expect(result.summary).toBe('summary');
  });
});
