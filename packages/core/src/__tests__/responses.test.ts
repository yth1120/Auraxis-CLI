import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResponsesClient } from '../responses.js';
import type { LlmRequest } from '../types.js';

afterEach(() => vi.unstubAllGlobals());

describe('ResponsesClient', () => {
  it('maps chat history and parses non-stream output', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            id: 'r1',
            status: 'completed',
            output: [
              { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'think' }] },
              { type: 'message', content: [{ type: 'output_text', text: 'hello' }] },
              { type: 'function_call', call_id: 'fc1', name: 'Read', arguments: '{"file_path":"a.ts"}' },
            ],
            usage: {
              input_tokens: 12,
              output_tokens: 3,
              input_tokens_details: { cached_tokens: 4 },
              output_tokens_details: { reasoning_tokens: 1 },
            },
          }),
          { status: 200 },
        );
      }),
    );
    const client = new ResponsesClient('key', 'https://api.deepseek.com', 'deepseek-v4-pro');
    const result = await client.chat({
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'hi' },
      ],
      tools: [{ name: 'Read', description: 'read', parameters: { type: 'object' } }],
      reasoningEffort: 'max',
      responseFormat: 'json_object',
      stream: false,
    });
    expect(result.content).toBe('hello');
    expect(result.reasoning).toBe('think');
    expect(result.toolCalls[0]).toMatchObject({ id: 'fc1', name: 'Read' });
    expect(result.usage?.cacheHitTokens).toBe(4);
    expect(captured.instructions).toBe('system');
    expect(captured.reasoning).toEqual({ effort: 'max' });
    expect(captured.text).toEqual({ format: { type: 'json_object' } });
    // 官方文档：Responses API 为无状态接口，store 恒为 false。
    expect(captured.store).toBe(false);
  });

  it('disables thinking via reasoning effort none when thinking is off', async () => {
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
    const client = new ResponsesClient('key', 'https://api.deepseek.com', 'deepseek-flash');
    await client.chat({
      messages: [{ role: 'user', content: 'hi' }],
      thinking: false,
      reasoningEffort: 'max',
      temperature: 1.4,
      stream: false,
    });
    expect(captured.reasoning).toEqual({ effort: 'none' });
    expect(captured.model).toBe('deepseek-flash');
    expect(captured.temperature).toBe(1.4);
  });

  it('aggregates streamed output, reasoning and tool arguments', async () => {
    const events = [
      { type: 'response.created', sequence_number: 1 },
      { type: 'response.output_item.added', item: { id: 'msg1', type: 'message' } },
      { type: 'response.reasoning_text.delta', delta: 'think' },
      { type: 'response.output_text.delta', delta: 'hello' },
      { type: 'response.output_item.added', item: { id: 'fc1', type: 'function_call', call_id: 'fc1', name: 'Read' } },
      { type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: '{"file_path":"a' },
      { type: 'response.function_call_arguments.delta', item_id: 'fc1', delta: '.ts"}' },
      { type: 'response.completed', response: { status: 'completed' } },
    ];
    const payload = events
      .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      .join('');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(payload, { status: 200, headers: { 'content-type': 'text/event-stream' } })),
    );
    const client = new ResponsesClient('key', 'https://api.deepseek.com', 'deepseek-v4-flash');
    const thinking: string[] = [];
    const result = await client.chat({
      messages: [{ role: 'user', content: 'read' }],
      stream: true,
      onThinkingChunk: (chunk) => thinking.push(chunk),
    } satisfies LlmRequest);
    expect(result.content).toBe('hello');
    expect(result.reasoning).toBe('think');
    expect(result.toolCalls[0]?.name).toBe('Read');
    expect(result.toolCalls[0]?.args.file_path).toBe('a.ts');
    expect(thinking).toContain('think');
  });

  it('handles streamed item completion, malformed arguments and final usage', async () => {
    const events = [
      { type: 'response.output_item.added', item: { id: 'reason1', type: 'reasoning' } },
      { type: 'response.reasoning_text.delta', delta: 'think' },
      { type: 'response.output_item.added', item: { id: 'fc1', type: 'function_call', call_id: 'fc1', name: 'Read' } },
      { type: 'response.output_item.done', item: { id: 'fc1', type: 'function_call', call_id: 'fc1', name: 'Read', arguments: '{bad' } },
      { type: 'response.output_item.added', item: { id: 'msg1', type: 'message' } },
      { type: 'response.output_text.delta', delta: 'answer' },
      {
        type: 'response.completed',
        response: {
          status: 'completed',
          usage: {
            input_tokens: 10,
            output_tokens: 4,
            input_tokens_details: { cached_tokens: 2 },
            output_tokens_details: { reasoning_tokens: 1 },
          },
        },
      },
    ];
    const payload = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(payload, { status: 200, headers: { 'content-type': 'text/event-stream' } })),
    );
    const client = new ResponsesClient('key', 'https://api.deepseek.com', 'deepseek-v4-flash');
    const result = await client.chat({ messages: [{ role: 'user', content: 'x' }], stream: true });
    expect(result.content).toBe('answer');
    expect(result.reasoning).toBe('think');
    expect(result.toolCalls[0]?.args).toHaveProperty('raw');
    expect(result.usage?.cacheHitTokens).toBe(2);
  });

  it('maps assistant content arrays and unknown content parts', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            status: 'completed',
            output: [{ type: 'function_call', name: 'Unknown' }],
          }),
          { status: 200 },
        );
      }),
    );
    const client = new ResponsesClient('key', 'https://api.deepseek.com', 'deepseek-v4-flash');
    const result = await client.chat({
      messages: [
        { role: 'user', content: 'x' },
        {
          role: 'assistant',
          reasoning_content: 'reason',
          content: [{ type: 'text', text: 'hello' }],
          tool_calls: [{ id: 'fc1', name: 'Read', args: { file_path: 'a.ts' } }],
        },
        { role: 'tool', tool_call_id: 'fc1', content: [{ type: 'text', text: 'ok' }] },
      ],
      stream: false,
    });
    expect(result.toolCalls[0]?.name).toBe('Unknown');
    const input = captured.input as Array<Record<string, unknown>>;
    expect(input[0].type).toBe('message');
    expect(input[1].type).toBe('reasoning');
    expect(input[2]).toMatchObject({ type: 'message', role: 'assistant' });
    expect(input[3]).toMatchObject({ type: 'function_call', call_id: 'fc1' });
  });

  it('tolerates malformed stream lines and handles file_data and undefined content', async () => {
    const payload =
      'data: {bad\n\n' +
      'data: {"type":"response.output_text.delta","delta":"ok"}\n\n' +
      'data: [DONE]\n\n';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(payload, { status: 200, headers: { 'content-type': 'text/event-stream' } })),
    );
    const client = new ResponsesClient('key', 'https://api.deepseek.com', 'deepseek-v4-flash');
    expect((await client.chat({ messages: [{ role: 'user', content: 'x' }], stream: true })).content).toBe('ok');

    let captured: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return new Response(JSON.stringify({ id: 'r1', status: 'completed', output: [] }), { status: 200 });
      }),
    );
    await client.chat({
      messages: [
        { role: 'system', content: undefined },
        {
          role: 'user',
          content: [{ type: 'file', file_data: 'data:image/png;base64,AA==', filename: 'x.png' }],
        },
      ],
      tools: [{ name: 'Read', description: 'read', parameters: { type: 'object' } }],
      toolChoice: '' as never,
      stream: false,
    });
    const input = captured.input as Array<Record<string, unknown>>;
    expect(input[0].content).toContainEqual({ type: 'input_image', image_url: 'data:image/png;base64,AA==', name: 'x.png' });
  });

  it('maps named tool choices and image/file content parts', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return new Response(JSON.stringify({ id: 'r1', status: 'completed', output: [] }), { status: 200 });
      }),
    );
    const client = new ResponsesClient('key', 'https://api.deepseek.com', 'deepseek-v4-flash-vision-exp');
    await client.chat({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==', detail: 'low' } },
            { type: 'file', file_id: 'file-api-1' },
          ],
        },
      ],
      tools: [{ name: 'Read', description: 'read', parameters: { type: 'object' } }],
      toolChoice: 'Read',
      stream: false,
    });
    expect(captured.tool_choice).toEqual({ type: 'function', name: 'Read' });
    const input = captured.input as Array<Record<string, unknown>>;
    expect(input[0].content).toContainEqual({ type: 'input_image', image_url: 'data:image/png;base64,AA==', detail: 'low' });
    expect(input[0].content).toContainEqual({ type: 'input_image', file_id: 'file-api-1' });
  });

  it('surfaces HTTP and malformed response errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 500 })));
    const client = new ResponsesClient('key', 'https://api.deepseek.com', 'deepseek-v4-flash');
    await expect(client.chat({ messages: [{ role: 'user', content: 'x' }], stream: false })).rejects.toThrow('Responses API 500');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{bad', { status: 200 })));
    await expect(client.chat({ messages: [{ role: 'user', content: 'x' }], stream: false })).rejects.toThrow('无法解析');
  });
});
