import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpManager } from '../mcp/manager.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-mcp-server.cjs');

afterEach(() => vi.unstubAllGlobals());

describe('MCP failure paths', () => {
  it('records invalid stdio server errors and reports missing definitions', async () => {
    const manager = new McpManager([{ name: 'bad' }]);
    await manager.start();
    expect(manager.errors).toHaveLength(1);
    expect(manager.hasTool('mcp__bad__x')).toBe(false);
    expect(manager.getDefinition('mcp__bad__x')).toBeUndefined();
    await manager.close();
  });

  it('handles HTTP errors and malformed RPC responses', async () => {
    const fetchMock = vi.fn(async () => new Response('not-json', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const manager = new McpManager([{ name: 'http', transport: 'http', url: 'https://example.test/mcp' }]);
    await manager.start();
    expect(manager.errors[0]).toContain('http');
    await manager.close();
  });

  it('rejects server/tool mismatch and closes clients', async () => {
    const manager = new McpManager([{ name: 'demo', command: process.execPath, args: [fixture] }]);
    await manager.start();
    await expect(manager.call('other', 'mcp__demo__echo', {})).rejects.toThrow('未连接');
    await manager.close();
    await expect(manager.call('demo', 'mcp__demo__echo', {})).rejects.toThrow('未连接');
  });

  it('parses SSE transport and surfaces tool errors', async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { method?: string; id?: number | null };
      if (body.method === 'tools/list') {
        return new Response(
          `data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, result: { tools: [{ name: 'fail' }] } })}\n\n`,
          { status: 200 },
        );
      }
      if (body.method === 'tools/call') {
        return new Response(
          `data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, result: { content: [{ type: 'text', text: 'bad' }], isError: true } })}\n\n`,
          { status: 200 },
        );
      }
      return new Response(
        `data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, result: {} })}\n\n`,
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const manager = new McpManager([{ name: 'sse', transport: 'http', url: 'https://example.test/mcp' }]);
    await manager.start();
    await expect(manager.call('sse', 'mcp__sse__fail', {})).rejects.toThrow('bad');
    await manager.close();
  });

  it('records initialization RPC errors and malformed/empty SSE payloads', async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { method?: string; id?: number | null };
      if (body.method === 'initialize') {
        return new Response(`data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, error: { code: -1, message: 'init failed' } })}\n\n`, { status: 200 });
      }
      return new Response('data: [DONE]\n\n', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const manager = new McpManager([{ name: 'bad-sse', transport: 'http', url: 'https://example.test/mcp' }]);
    await manager.start();
    expect(manager.errors[0]).toContain('init failed');
    await manager.close();
  });

  it('ignores invalid tool lists and handles missing transports', async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as { method?: string; id?: number | null };
      return new Response(
        `data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id ?? null, result: body.method === 'tools/list' ? { tools: [{ name: 5 }] } : {} })}\n\n`,
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const manager = new McpManager([{ name: 'http', url: 'https://example.test/mcp' }]);
    await manager.start();
    expect(manager.getToolDefinitions()).toHaveLength(0);
    await manager.close();

    const noCommand = new McpManager([{ name: 'bad' }]);
    await noCommand.start();
    expect(noCommand.errors[0]).toContain('未配置 command');
    await noCommand.close();
  });
});
