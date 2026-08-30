import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLlmClient } from '../providers.js';

afterEach(() => vi.unstubAllGlobals());

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

describe('provider branch coverage', () => {
  it('retries transient provider errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ error: { message: 'slow' } }, 500))
      .mockResolvedValueOnce(response({ content: [{ type: 'text', text: 'ok' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createLlmClient({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'key',
      apiBase: 'https://api.anthropic.com/v1/messages',
      maxRetries: 2,
    });
    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }], stream: false });
    expect(result.content).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable errors or abort requests', async () => {
    const fetchMock = vi.fn(async () => new Response('plain', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createLlmClient({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'key',
      apiBase: 'https://api.anthropic.com/v1/messages',
    });
    // Invalid JSON is a non-retryable parse error.
    await expect(client.chat({ messages: [], stream: false })).rejects.toThrow('无法解析');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('handles anthropic tool messages and missing ids', async () => {
    const fetchMock = vi.fn(async () =>
      response({
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } },
        ],
        stop_reason: 'tool_use',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createLlmClient({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'key',
      apiBase: 'https://api.anthropic.com/v1/messages',
    });
    const result = await client.chat({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'call', name: 'Read', args: {} }] },
        { role: 'tool', tool_call_id: 'call', name: 'Read', content: '{"ok":true}' },
      ],
      tools: [{ name: 'Read', description: 'read', parameters: { type: 'object' } }],
      stream: false,
    });
    expect(result.toolCalls[0]?.id).toMatch(/^tool_/);
  });

  it('handles gemini empty responses and tool results', async () => {
    const fetchMock = vi.fn(async () =>
      response({
        candidates: [{ content: { parts: [{ text: 'gemini' }] } }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createLlmClient({
      provider: 'gemini',
      model: 'gemini-3.1-pro',
      apiKey: 'key',
      apiBase: 'http://example.test/v1beta/models',
    });
    const result = await client.chat({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', tool_calls: [{ id: '1', name: 'Read', args: { file_path: 'a.ts' } }] },
        { role: 'tool', tool_call_id: '1', name: 'Read', content: 'not-json' },
      ],
      tools: [{ name: 'Read', description: 'read', parameters: { type: 'object' } }],
      stream: false,
    });
    expect(result.content).toBe('gemini');
    expect(result.toolCalls).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('uses default choices and retry policies for openai clients', async () => {
    const fetchMock = vi.fn(async () => response({ choices: [] }, 200));
    vi.stubGlobal('fetch', fetchMock);
    const client = createLlmClient({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'key',
      apiBase: 'https://api.openai.com/v1/chat/completions',
    });
    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }], stream: false });
    expect(result.content).toBe('');
  });

  it('forwards usage and handles zero retries', async () => {
    const usages: Array<{ inputTokens: number; outputTokens: number }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 2, output_tokens: 3 },
        }),
      ),
    );
    const client = createLlmClient({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'key',
      apiBase: 'https://api.anthropic.com/v1/messages',
      maxRetries: 1,
    });
    const result = await client.chat({
      messages: [{ role: 'user', content: 'x' }],
      stream: false,
      onUsage: (usage) => usages.push(usage),
    });
    expect(result.content).toBe('ok');
    expect(usages).toHaveLength(1);

    const noRetry = createLlmClient({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'key',
      apiBase: 'https://api.anthropic.com/v1/messages',
      maxRetries: 0,
    });
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'bad' }, 500)));
    await expect(noRetry.chat({ messages: [], stream: false })).rejects.toThrow('API 重试次数已耗尽');
  });

  it('reports missing gemini key with provider name', async () => {
    const client = createLlmClient({
      provider: 'gemini',
      model: 'gemini-3.1-pro',
      apiKey: '',
      apiBase: 'http://example.test/v1beta/models',
    });
    await expect(client.chat({ messages: [], stream: false })).rejects.toThrow('Gemini API Key');
  });
});
