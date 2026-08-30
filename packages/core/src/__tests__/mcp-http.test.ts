import { describe, expect, it, vi } from 'vitest';
import { McpManager } from '../mcp/manager.js';

describe('HTTP MCP', () => {
  it('discovers and calls tools through a streamable HTTP endpoint', async () => {
    const methods: string[] = [];
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { method?: string; params?: Record<string, unknown>; id?: number | null };
      methods.push(body.method || '');
      if (body.method === 'tools/list') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id ?? null,
            result: { tools: [{ name: 'echo', description: 'echo tool', inputSchema: { type: 'object' } }] },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (body.method === 'tools/call') {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, result: { content: [{ type: 'text', text: 'pong' }] } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, result: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const manager = new McpManager([
        { name: 'http', transport: 'http', url: 'https://example.test/mcp' },
      ]);
      await manager.start();
      expect(manager.getToolDefinitions().map((tool) => tool.name)).toContain('mcp__http__echo');
      expect(await manager.call('http', 'mcp__http__echo', { value: 1 })).toBe('pong');
      expect(methods).toContain('initialize');
      expect(methods).toContain('tools/list');
      expect(methods).toContain('tools/call');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
