import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLlmClient } from '../providers.js';

afterEach(() => vi.unstubAllGlobals());

describe('provider response edge cases', () => {
  it('parses Anthropic thinking and tool blocks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            content: [
              { type: 'thinking', thinking: 'think' },
              { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } },
            ],
            stop_reason: 'tool_use',
          }),
          { status: 200 },
        ),
      ),
    );
    const client = createLlmClient({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'key',
      apiBase: 'https://api.anthropic.com/v1/messages',
    });
    const result = await client.chat({ messages: [{ role: 'user', content: 'x' }], stream: false });
    expect(result.reasoning).toBe('think');
    expect(result.toolCalls[0]).toMatchObject({ name: 'Read' });
  });

  it('routes Responses and DeepSeek Anthropic presets through the factory', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ id: 'r1', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }),
          { status: 200 },
        );
      }),
    );
    const responses = createLlmClient({
      provider: 'deepseek',
      apiFamily: 'responses',
      model: 'deepseek-v4-flash',
      apiKey: 'key',
      apiBase: 'https://api.deepseek.com',
    });
    expect((await responses.chat({ messages: [{ role: 'user', content: 'x' }], stream: false })).content).toBe('ok');
    expect(captured.model).toBe('deepseek-v4-flash');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            content: [
              { type: 'thinking', thinking: 'think' },
              { type: 'text', text: 'ok' },
            ],
            stop_reason: 'end_turn',
          }),
          { status: 200 },
        );
      }),
    );
    const anthropic = createLlmClient({
      provider: 'deepseek',
      apiFamily: 'anthropic',
      model: 'deepseek-v4-pro',
      apiKey: 'key',
      apiBase: 'https://api.deepseek.com/anthropic/v1/messages',
    });
    const result = await anthropic.chat({
      messages: [{ role: 'user', content: 'x' }],
      reasoningEffort: 'max',
      stream: false,
    });
    expect(result.reasoning).toBe('think');
    expect(captured.output_config).toEqual({ effort: 'max' });
    expect(captured.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }),
          { status: 200 },
        );
      }),
    );
    await anthropic.chat({ messages: [{ role: 'user', content: 'x' }], thinking: false, stream: false });
    expect(captured.thinking).toEqual({ type: 'disabled' });
    expect(captured).not.toHaveProperty('output_config');
  });

  it('parses Gemini tool calls and rejects invalid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ functionCall: { name: 'Write', args: { file_path: 'a.txt' } } }] }, finishReason: 'STOP' }],
          }),
          { status: 200 },
        ),
      ),
    );
    const client = createLlmClient({
      provider: 'gemini',
      model: 'gemini-3.1-pro',
      apiKey: 'key',
      apiBase: 'http://example.test/v1beta/models',
    });
    const result = await client.chat({ messages: [{ role: 'user', content: 'write' }], stream: false });
    expect(result.toolCalls[0]).toMatchObject({ name: 'Write' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{bad', { status: 200 })));
    await expect(client.chat({ messages: [{ role: 'user', content: 'x' }], stream: false })).rejects.toThrow('无法解析');
  });

  it('uses the OpenAI-compatible client for openai/custom providers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
          { status: 200 },
        ),
      ),
    );
    const client = createLlmClient({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'key',
      apiBase: 'https://api.openai.com/v1/chat/completions',
    });
    expect((await client.chat({ messages: [{ role: 'user', content: 'x' }], stream: false })).content).toBe('ok');
  });

  it('keeps reasoning history for DeepSeek and strips it for non-DeepSeek endpoints', async () => {
    let captured: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
          { status: 200 },
        );
      }),
    );
    const messages = [
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: '', reasoning_content: 'think' },
    ];
    const deepseek = createLlmClient({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      apiKey: 'key',
      apiBase: 'https://api.deepseek.com/chat/completions',
    });
    await deepseek.chat({
      messages,
      tools: [{ name: 'Read', description: 'read', parameters: { type: 'object' } }],
      stream: false,
    });
    const deepseekMessages = captured?.messages as Array<Record<string, unknown>>;
    expect(deepseekMessages[1].reasoning_content).toBe('think');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
          { status: 200 },
        );
      }),
    );
    const openai = createLlmClient({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'key',
      apiBase: 'https://api.openai.com/v1/chat/completions',
    });
    await openai.chat({
      messages,
      tools: [{ name: 'Read', description: 'read', parameters: { type: 'object' } }],
      stream: false,
    });
    const openaiMessages = captured?.messages as Array<Record<string, unknown>>;
    expect(openaiMessages[1]).not.toHaveProperty('reasoning_content');
  });

  it('supports ollama/custom clients and rejects missing keys', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'local' }, finish_reason: 'stop' }] }),
          { status: 200 },
        ),
      ),
    );
    const ollama = createLlmClient({
      provider: 'ollama',
      model: 'qwen',
      apiKey: '',
      apiBase: 'http://localhost:11434/v1/chat/completions',
    });
    await expect(ollama.chat({ messages: [{ role: 'user', content: 'x' }], stream: false })).rejects.toThrow('API Key');
    const custom = createLlmClient({
      provider: 'custom',
      model: 'local',
      apiKey: 'k',
      apiBase: 'http://localhost:9000/v1/chat/completions',
    });
    expect((await custom.chat({ messages: [{ role: 'user', content: 'x' }], stream: false })).content).toBe('local');
  });

  it('surfaces provider HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream failed', { status: 500 })));
    const client = createLlmClient({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: 'key',
      apiBase: 'https://api.anthropic.com/v1/messages',
    });
    await expect(client.chat({ messages: [{ role: 'user', content: 'x' }], stream: false })).rejects.toThrow('500');
  });
});
