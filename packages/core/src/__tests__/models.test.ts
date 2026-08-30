import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLiveModels, modelsEndpoint, resolveModelChoices } from '../models.js';

afterEach(() => vi.unstubAllGlobals());

describe('live model discovery', () => {
  it('builds the models endpoint from the API base origin', () => {
    expect(modelsEndpoint('https://custom.example/v1/chat/completions')).toBe(
      'https://custom.example/models',
    );
    expect(modelsEndpoint('https://api.deepseek.com/beta/chat/completions')).toBe(
      'https://api.deepseek.com/models',
    );
  });

  it('parses and sorts the official model list', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
            { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await fetchLiveModels('test-key');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/models',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer test-key',
        },
      }),
    );
    expect(models.map((item) => item.id)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
    ]);
    expect(models[0]).toMatchObject({
      name: 'DeepSeek V4 Flash',
      provider: 'deepseek',
    });
  });

  it('falls back to built-in models when the network fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    const result = await resolveModelChoices('test-key');

    expect(result.source).toBe('builtin');
    expect(result.models.length).toBeGreaterThan(0);
    expect(result.models.some((item) => item.id === 'deepseek-v4-flash')).toBe(true);
  });

  it('falls back to built-in models when the response has no models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ object: 'list', data: [] }), { status: 200 }),
      ),
    );

    const result = await resolveModelChoices('test-key');

    expect(result.source).toBe('builtin');
    expect(result.models.length).toBeGreaterThan(0);
  });
});
