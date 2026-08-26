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

  it('parses non-stream JSON responses', async () => {
    const client = new DeepSeekClient('test-key', `${baseUrl}/non-stream`, 'deepseek-v4-pro');
    const result = await client.chat({ messages: [{ role: 'user', content: 'hi' }], stream: false });
    expect(result.content).toBe('ok');
    expect(result.usage?.outputTokens).toBe(4);
  });
});

