import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepSeekClient } from '../llm.js';

afterEach(() => vi.unstubAllGlobals());

function streamResponse(payload: string): Response {
  return new Response(payload, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('DeepSeek branch coverage', () => {
  it('parses stream ignores malformed and empty pages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse(
          'not-json\n' +
            'data: {"choices":[{"delta":{}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' +
            'data: [DONE]\n\n',
        ),
      ),
    );
    const client = new DeepSeekClient('key', 'https://example.test/v1/chat/completions', 'm', 100, 1);
    const result = await client.chat({
      messages: [{ role: 'user', content: 'hi' }],
      reasoningEffort: 'high',
      responseFormat: 'json_object',
      stream: true,
    });
    expect(result.content).toBe('ok');
    expect(result.finishReason).toBeUndefined();
  });

  it('assembles fragmented tool calls and keeps malformed arguments', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"Read"}}]}}]}\n\n' +
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"file_path\\":\\"a.ts\\"}"}}]}}]}\n\n' +
            'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","function":{"name":"Write","arguments":"not-json"}}]}}]}\n\n' +
            'data: [DONE]\n\n',
        ),
      ),
    );
    const client = new DeepSeekClient('key', 'https://example.test/v1/chat/completions', 'm');
    const result = await client.chat({ messages: [], stream: true });
    expect(result.toolCalls[0]?.name).toBe('Read');
    expect(result.toolCalls[0]?.args).toMatchObject({ file_path: 'a.ts' });
    expect(result.toolCalls[1]?.args).toHaveProperty('raw');
  });

  it('handles empty non-stream choices and usage details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [],
            usage: {
              prompt_tokens: 2,
              completion_tokens: 3,
              completion_tokens_details: { reasoning_tokens: 1 },
              prompt_cache_hit_tokens: 4,
              prompt_cache_miss_tokens: 5,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const client = new DeepSeekClient('key', 'https://example.test/v1/chat/completions', 'm');
    const result = await client.chat({ messages: [], stream: false });
    expect(result.content).toBe('');
    expect(result.usage?.reasoningTokens).toBe(1);
  });

  it('serializes reasoning effort, tools and response format into the wire body', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const client = new DeepSeekClient('key', 'https://example.test/v1/chat/completions', 'm');
    await client.chat({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'Read', description: 'read', parameters: { type: 'object' } }],
      toolChoice: 'required',
      reasoningEffort: 'max',
      responseFormat: 'json_object',
      temperature: 0.2,
      stream: false,
    });
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.tool_choice).toBe('required');
    expect(body.temperature).toBe(0.2);
  });

  it('emits thinking events and captures finish reason in stream', async () => {
    const thinking: Array<[string, boolean | undefined]> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamResponse(
          'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":"ans"},"finish_reason":"stop"}]}\n\n' +
            'data: [DONE]\n\n',
        ),
      ),
    );
    const client = new DeepSeekClient('key', 'https://example.test/v1/chat/completions', 'm');
    const result = await client.chat({
      messages: [],
      stream: true,
      onThinkingChunk: (text, isNewBlock) => thinking.push([text, isNewBlock]),
    });
    expect(result.finishReason).toBe('stop');
    expect(thinking).toContainEqual(['', true]);
  });

  it('exhausts retries for permanent HTTP failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 500 })),
    );
    const client = new DeepSeekClient('key', 'https://example.test/v1/chat/completions', 'm', 100, 2);
    await expect(client.chat({ messages: [], stream: false })).rejects.toThrow('API 500');
  });

  it('handles missing tool ids, malformed tool args and missing keys', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { tool_calls: [{ id: '', function: { name: 'Read', arguments: '{bad' } }] }, finish_reason: 'tool_calls' }],
          }),
          { status: 200 },
        ),
      ),
    );
    const client = new DeepSeekClient('key', 'https://example.test/v1/chat/completions', 'm');
    const result = await client.chat({ messages: [], stream: false });
    expect(result.toolCalls[0]?.id).toMatch(/^call_/);
    expect(result.toolCalls[0]?.args).toHaveProperty('raw');

    const noKey = new DeepSeekClient('', 'https://example.test/v1/chat/completions', 'm');
    await expect(noKey.chat({ messages: [], stream: false })).rejects.toThrow('未配置 API Key');
  });
});
