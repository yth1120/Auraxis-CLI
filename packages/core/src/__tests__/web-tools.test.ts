import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webFetchTool, webSearchTool } from '../tools/web.js';
import { reviewArtifactTool } from '../tools/review.js';
import type { ToolContext } from '../tools/registry.js';

function context(root: string): ToolContext {
  return { projectRoot: root, emit: () => {}, todos: [], setTodos: () => {} };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('web tools', () => {
  it('fetches and strips HTML', async () => {
    const fetchMock = vi.fn(async () => new Response('<html><script>x</script><p>Hello <b>world</b></p></html>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-web-'));
    const result = await webFetchTool({ url: 'https://example.test', max_chars: 100 }, context(root));
    expect(result.content).toContain('Hello world');
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.any(Object));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no max', { status: 200 })));
    expect((await webFetchTool({ url: 'https://example.test' }, context(root))).content).toBe('no max');
  });

  it('returns search results and rejects bad protocol', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        '<html><div class="result results_links"><a class="result__a" href="https://a.test">A</a><a class="result__snippet">snip</a></div></div></html>',
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-search-'));
    const result = await webSearchTool({ query: 'hello', max_results: 1 }, context(root));
    expect(result.content).toContain('A');
    await expect(webFetchTool({ url: 'file:///tmp/a' }, context(root))).rejects.toThrow('仅支持 http/https');
  });

  it('rejects missing URLs, bad responses and no search hits', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-web-extra-'));
    try {
      await expect(webFetchTool({}, context(root))).rejects.toThrow('url 不能为空');
      vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 500 })));
      await expect(webFetchTool({ url: 'https://example.test' }, context(root))).rejects.toThrow('HTTP 500');
      vi.stubGlobal('fetch', vi.fn(async () => new Response('<p>no results</p>', { status: 200 })));
      const search = await webSearchTool({ query: 'nothing' }, context(root));
      expect(search.content).toContain('未找到');
      await expect(webSearchTool({}, context(root))).rejects.toThrow('query 不能为空');
      vi.stubGlobal('fetch', vi.fn(async () => new Response('<div class="result results_links"><p>no title</p></div></div>', { status: 200 })));
      expect((await webSearchTool({ query: 'q' }, context(root))).content).toContain('未找到');
      vi.stubGlobal('fetch', vi.fn(async () => new Response('<div class="result results_links"><a class="result__a" href="x">A</a></div></div>', { status: 200 })));
      expect((await webSearchTool({ query: 'q', max_results: 50 }, context(root))).content).toContain('A');
      expect((await webSearchTool({ query: 'q', max_results: 0 }, context(root))).content).toContain('A');
      vi.stubGlobal('fetch', vi.fn(async () => new Response('<div class="result results_links"><a class="result__a" href="//html.duckduckgo.com/html/?uddg=https%3A%2F%2Fdecoded.test">decoded</a></div></div>', { status: 200 })));
      expect((await webSearchTool({ query: 'q' }, context(root))).content).toContain('https://decoded.test');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('review tool', () => {
  it('runs a custom command when no package script is available', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-review-'));
    try {
      const result = await reviewArtifactTool(
        { command: 'node -e "console.log(\'review-ok\')"' },
        context(root),
      );
      expect(result.content).toContain('review-ok');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('prefers a package.json check script when command is omitted', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-review-script-'));
    try {
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ scripts: { check: 'node -e "console.log(\'script-ok\')"' } }),
        'utf8',
      );
      const result = await reviewArtifactTool({}, context(root));
      expect(result.content).toContain('script-ok');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
