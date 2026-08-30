import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeepSeekClient } from '../llm.js';

let server: http.Server;
let baseUrl = '';

beforeAll(async () => {
  server = http.createServer((request, response) => {
    if (request.url?.includes('non-stream')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          choices: [{ message: { content: 'ok', tool_calls: [] }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 8, completion_tokens: 4 },
        }),
      );
      return;
    }
    response.setHeader('Content-Type', 'text/event-stream');
    response.write('data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\n');
    response.write('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n');
    response.write(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"Read","arguments":"{\\"file_path\\":\\"a.ts\\"}"}}]}}]}\n\n',
    );
    response.write('data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n');
    response.write('data: [DONE]\n\n');
    response.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        baseUrl = `http://127.0.0.1:${address.port}/chat/completions`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe('DeepSeekClient', () => {
  it('parses streamed text, thinking, tools and usage', async () => {
    const client = new DeepSeekClient('test-key', baseUrl, 'deepseek-v4-pro');
    const textChunks: string[] = [];
    const thinking: string[] = [];
    const result = await client.chat({
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 'Read', description: 'read', parameters: { type: 'object' } }],
      stream: true,
      onTextChunk: (chunk) => textChunks.push(chunk),
      onThinkingChunk: (chunk) => thinking.push(chunk),
    });
    expect(textChunks.join('')).toBe('hello');
    expect(thinking).toContain('think');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].args.file_path).toBe('a.ts');
    expect(result.usage?.inputTokens).toBe(10);
  });

  it('omits stream_options so provider streams individual chunks', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const streamServer = http.createServer((request, response) => {
      let raw = '';
      request.on('data', (chunk) => (raw += String(chunk)));
      request.on('end', () => {
        capturedBody = JSON.parse(raw) as Record<string, unknown>;
        response.setHeader('Content-Type', 'text/event-stream');
        response.write('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\n');
        response.write('data: [DONE]\n\n');
        response.end();
      });
    });
    await new Promise<void>((resolve) => streamServer.listen(0, '127.0.0.1', resolve));
    const address = streamServer.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/chat/completions`;
    try {
      const client = new DeepSeekClient('test-key', url, 'deepseek-v4-pro');
      const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }], stream: true });
      expect(capturedBody?.stream_options).toBeUndefined();
      expect(result.content).toBe('ok');
    } finally {
      await new Promise<void>((resolve, reject) => streamServer.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('parses non-stream JSON responses', async () => {
    const client = new DeepSeekClient('test-key', `${baseUrl}/non-stream`, 'deepseek-v4-pro');
    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }], stream: false });
    expect(result.content).toBe('ok');
    expect(result.usage?.outputTokens).toBe(4);
  });

  it('retries transient HTTP failures before succeeding', async () => {
    let calls = 0;
    const retryServer = http.createServer((_request, response) => {
      calls += 1;
      if (calls === 1) {
        response.statusCode = 429;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ error: { message: 'rate limited' } }));
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          choices: [{ message: { content: 'recovered', tool_calls: [] }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
    });
    await new Promise<void>((resolve) => retryServer.listen(0, '127.0.0.1', resolve));
    const address = retryServer.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/chat/completions`;
    try {
      const client = new DeepSeekClient('test-key', url, 'deepseek-v4-pro');
      const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }], stream: false });
      expect(calls).toBe(2);
      expect(result.content).toBe('recovered');
    } finally {
      await new Promise<void>((resolve, reject) => retryServer.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('serializes assistant tool calls into the OpenAI wire format', async () => {
    let captured: Record<string, unknown> | undefined;
    const wireServer = http.createServer((request, response) => {
      let raw = '';
      request.on('data', (chunk) => (raw += String(chunk)));
      request.on('end', () => {
        captured = JSON.parse(raw) as Record<string, unknown>;
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            choices: [{ message: { content: 'ok', tool_calls: [] }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => wireServer.listen(0, '127.0.0.1', resolve));
    const address = wireServer.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/chat/completions`;
    try {
      const client = new DeepSeekClient('test-key', url, 'deepseek-v4-pro');
      await client.chat({
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'call_1', name: 'Read', args: { file_path: 'a.ts' } }],
          },
          { role: 'tool', tool_call_id: 'call_1', name: 'Read', content: '{"ok":true}' },
        ],
        stream: false,
      });
    } finally {
      await new Promise<void>((resolve, reject) => wireServer.close((error) => (error ? reject(error) : resolve())));
    }
    const wireMessages = captured?.messages as Array<Record<string, unknown>>;
    expect(wireMessages[1]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'Read', arguments: '{"file_path":"a.ts"}' },
        },
      ],
    });
  });

  it('preserves thinking content when a DeepSeek tool conversation is replayed', async () => {
    let captured: Record<string, unknown> | undefined;
    const wireServer = http.createServer((request, response) => {
      let raw = '';
      request.on('data', (chunk) => (raw += String(chunk)));
      request.on('end', () => {
        captured = JSON.parse(raw) as Record<string, unknown>;
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            choices: [{ message: { content: 'ok', tool_calls: [] }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => wireServer.listen(0, '127.0.0.1', resolve));
    const address = wireServer.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/chat/completions`;
    try {
      const client = new DeepSeekClient('test-key', url, 'deepseek-v4-pro', 32768, 3, true);
      await client.chat({
        messages: [
          { role: 'user', content: 'read a.ts' },
          {
            role: 'assistant',
            content: '',
            reasoning_content: '需要先读取文件确认内容。',
            tool_calls: [{ id: 'call_1', name: 'Read', args: { file_path: 'a.ts' } }],
          },
          { role: 'tool', tool_call_id: 'call_1', name: 'Read', content: '{"ok":true}' },
        ],
        tools: [{ name: 'Read', description: 'read', parameters: { type: 'object' } }],
        stream: false,
      });
    } finally {
      await new Promise<void>((resolve, reject) => wireServer.close((error) => (error ? reject(error) : resolve())));
    }
    const wireMessages = captured?.messages as Array<Record<string, unknown>>;
    expect(wireMessages[1]).toMatchObject({
      role: 'assistant',
      reasoning_content: '需要先读取文件确认内容。',
    });
  });
});
