import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeepSeekFilesClient } from '../files.js';

afterEach(() => vi.unstubAllGlobals());

describe('DeepSeekFilesClient', () => {
  it('uploads, lists, retrieves and deletes files', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        calls.push(String(init?.method || 'GET'));
        return new Response(
          JSON.stringify({ id: 'file-api-1', object: 'file', bytes: 123, filename: 'a.png', purpose: 'user_data' }),
          { status: 200 },
        );
      }),
    );
    const client = new DeepSeekFilesClient({
      provider: 'deepseek',
      apiKey: 'key',
      apiBase: 'https://api.deepseek.com/beta/chat/completions',
    });
    const uploaded = await client.upload({ name: 'a.png', buffer: Buffer.from('png'), mimeType: 'image/png' });
    expect(uploaded.id).toBe('file-api-1');
    expect(calls).toContain('POST');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'file-api-1', bytes: 1, filename: 'a.png' }] }), { status: 200 })),
    );
    expect((await client.list()).data[0]?.id).toBe('file-api-1');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'file-api-1', bytes: 1, filename: 'a.png' }), { status: 200 })),
    );
    expect((await client.retrieve('file-api-1')).id).toBe('file-api-1');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'file-api-1', deleted: true }), { status: 200 })),
    );
    expect((await client.delete('file-api-1')).deleted).toBe(true);
  });

  it('surfaces upload errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 401 })));
    const client = new DeepSeekFilesClient({ provider: 'deepseek', apiKey: 'key', apiBase: 'https://api.deepseek.com' });
    await expect(
      client.upload({ name: 'a.png', buffer: Buffer.from('png'), mimeType: 'image/png' }),
    ).rejects.toThrow('401');
  });

  it('handles list pagination, Anthropic-shaped timestamps and missing ids', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        expect(String(init?.method || 'GET')).toBe('GET');
        return new Response(
          JSON.stringify({
            data: [{ id: 'file-api-2', type: 'file', size_bytes: 2048, created_at: '2026-01-01T00:00:00+00:00' }],
            first_id: 'file-api-2',
            last_id: 'file-api-2',
            has_more: true,
          }),
          { status: 200 },
        );
      }),
    );
    const client = new DeepSeekFilesClient({ provider: 'deepseek', apiKey: 'k', apiBase: 'https://api.deepseek.com' });
    const result = await client.list({ after: 'file-api-1', limit: 10, order: 'desc' });
    expect(result.has_more).toBe(true);
    expect(result.data[0]?.bytes).toBe(2048);
    expect(result.data[0]?.created_at).toBeDefined();

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    await expect(client.retrieve('file-api-2')).rejects.toThrow('缺少文件 ID');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'file-api-2', deleted: true }), { status: 200 })));
    expect((await client.delete('file-api-2')).deleted).toBe(true);
  });

  it('rejects requests without an API key', async () => {
    const client = new DeepSeekFilesClient({ provider: 'deepseek', apiKey: '', apiBase: 'https://api.deepseek.com' });
    await expect(client.upload({ name: 'a.png', buffer: Buffer.from('a'), mimeType: 'image/png' })).rejects.toThrow('未配置');
  });

  it('sends custom model headers', async () => {
    let captured: RequestInit | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        captured = init;
        return new Response(
          JSON.stringify({ id: 'file-api-3', object: 'file', bytes: 1, filename: 'a.png' }),
          { status: 200 },
        );
      }),
    );
    const client = new DeepSeekFilesClient({
      provider: 'deepseek',
      apiKey: 'key',
      apiBase: 'https://api.deepseek.com',
      headers: { 'x-gateway': 'custom' },
    });
    await client.retrieve('file-api-3');
    expect((captured?.headers as Record<string, string>)['x-gateway']).toBe('custom');
  });
});
