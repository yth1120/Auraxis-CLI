import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { McpManager } from '../mcp/manager.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-mcp-server.cjs');

describe('McpManager', () => {
  it('discovers and calls MCP tools over stdio', async () => {
    const manager = new McpManager([
      {
        name: 'demo',
        command: process.execPath,
        args: [fixture],
      },
    ]);
    await manager.start();
    try {
      expect(manager.errors).toHaveLength(0);
      const tools = manager.getToolDefinitions();
      expect(tools.some((tool) => tool.name === 'mcp__demo__echo')).toBe(true);
      const output = await manager.call('demo', 'mcp__demo__echo', { text: 'hello' });
      expect(output).toBe('echo hello');
    } finally {
      await manager.close();
    }
  });
});

