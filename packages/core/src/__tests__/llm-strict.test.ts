import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepSeekClient, normalizeStrictSchema } from '../llm.js';

afterEach(() => vi.unstubAllGlobals());

describe('DeepSeek strict tools and completion endpoints', () => {
  it('normalizes object schemas for strict function calling', () => {
    const schema = {
      type: 'object',
      properties: {
        file_path: { type: 'string', minLength: 1 },
        tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
    };
    const normalized = normalizeStrictSchema(schema);
    expect(normalized.additionalProperties).toBe(false);
    expect(normalized.required).toEqual(['file_path', 'tags']);
    const properties = normalized.properties as Record<string, unknown>;
    expect(properties.file_path).not.toHaveProperty('minLength');
    expect(properties.tags).not.toHaveProperty('minItems');
  });

  it('normalizes compound schemas and supports ref definitions', () => {
    const schema = {
      type: 'object',
      properties: {
        account: {
          anyOf: [
            { type: 'string', format: 'email' },
            { type: 'string', pattern: '^\\d{11}$' },
          ],
        },
      },
      $def: { author: { type: 'object', properties: { name: { type: 'string' } } } },
    };
    const normalized = normalizeStrictSchema(schema);
    expect((normalized.properties as Record<string, unknown>).account).toHaveProperty('anyOf');
    expect(normalized.$def).toBeDefined();
    expect((normalized.$def as Record<string, unknown>).author).toMatchObject({ additionalProperties: false });
  });

  it('surfaces prefix and FIM completion responses', async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }),
          { status: 200 },
        );
      }),
    );
    const client = new DeepSeekClient('key', 'https://api.deepseek.com/beta/chat/completions', 'deepseek-v4-flash');
    expect(await client.completePrefix({ prefix: 'function test() {' })).toBe('done');
    expect((body.messages as Array<Record<string, unknown>>)[1].prefix).toBe(true);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, _init?: RequestInit) =>
        new Response(JSON.stringify({ choices: [{ text: 'middle' }] }), { status: 200 }),
      ),
    );
    expect(await client.completeFim({ prompt: 'function test() {', suffix: '}' })).toBe('middle');
  });

  it('surfaces malformed and FIM HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{bad', { status: 200 })));
    const client = new DeepSeekClient('key', 'https://api.deepseek.com/beta/chat/completions', 'deepseek-v4-flash');
    await expect(client.completePrefix({ prefix: 'x' })).rejects.toThrow('无法解析');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 400 })));
    await expect(client.completeFim({ prompt: 'x' })).rejects.toThrow('FIM API 400');
  });

  it('sends custom model headers on completion requests', async () => {
    let captured: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        captured = init;
        return new Response(
          JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
          { status: 200 },
        );
      }),
    );
    const client = new DeepSeekClient(
      'key',
      'https://api.deepseek.com/beta/chat/completions',
      'deepseek-v4-flash',
      32768,
      1,
      true,
      true,
      { 'x-gateway': 'custom' },
    );
    await client.completePrefix({ prefix: 'x' });
    expect((captured?.headers as Record<string, string>)['x-gateway']).toBe('custom');
  });
});
