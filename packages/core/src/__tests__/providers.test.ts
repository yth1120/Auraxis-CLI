import { describe, expect, it, vi } from 'vitest';
import { createLlmClient } from '../providers.js';

describe('multi-provider clients', () => {
  it('maps Anthropic content blocks to internal tool calls', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          content: [
            { type: 'text', text: 'hello' },
            { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = createLlmClient({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        apiKey: 'test-key',
        apiBase: 'https://api.anthropic.com/v1/messages',
      });
      const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }], tools: [], stream: false });
      expect(result.content).toBe('hello');
      expect(result.toolCalls[0]).toMatchObject({ id: 't1', name: 'Read' });
      expect(result.finishReason).toBe('tool_use');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('maps Gemini function calls to internal tool calls', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ functionCall: { name: 'Write', args: { file_path: 'a.txt' } } }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const client = createLlmClient({
        provider: 'gemini',
        model: 'gemini-3.1-pro',
        apiKey: 'test-key',
        apiBase: 'http://example.test/v1beta/models',
      });
      const result = await client.chat({ messages: [{ role: 'user', content: 'write' }], tools: [], stream: false });
      expect(result.toolCalls[0]).toMatchObject({ name: 'Write', args: { file_path: 'a.txt' } });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
