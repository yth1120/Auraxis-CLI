import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { JsonObject, McpHost, McpServerConfig, ToolDefinition } from '../types.js';
import { CORE_VERSION } from '../version.js';
import { safeProcessEnv } from '../safe-env.js';
import {
  mcpCallResultSchema,
  mcpToolsResultSchema,
  parseJson,
  rpcResponseSchema,
} from '../validation.js';

interface RpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface McpTransportClient {
  start(): Promise<void>;
  listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: JsonObject }>>;
  call(tool: string, args: JsonObject): Promise<string>;
  close(): Promise<void>;
}

function shouldUseShell(command: string): boolean {
  const base = command.split(/[\\/]/).pop()?.toLowerCase() || '';
  return /\.(cmd|bat|ps1)$/i.test(base) || ['npx', 'npm', 'yarn', 'pnpm'].includes(base) || command.includes(' && ');
}

function toolName(server: string, raw: string): string {
  const safeServer = server.replace(/[^\w-]+/g, '_');
  const safeTool = raw.replace(/[^\w-]+/g, '_');
  return `mcp__${safeServer}__${safeTool}`;
}

class McpClient implements McpTransportClient {
  private child: ReturnType<typeof spawn> | null = null;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 1;
  private closed = false;

  constructor(private readonly config: McpServerConfig) {
    if (!config.command) throw new Error(`MCP ${config.name} 未配置 command`);
  }

  async start(): Promise<void> {
    if (this.closed) throw new Error('MCP client already closed');
    const command = this.config.command;
    if (!command) throw new Error(`MCP ${this.config.name} 未配置 command`);
    const child = spawn(command, this.config.args || [], {
      cwd: process.cwd(),
      env: { ...safeProcessEnv(), ...this.config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: shouldUseShell(command),
    });
    this.child = child;
    child.stderr.on('data', (chunk) => {
      const text = String(chunk).trim();
      if (text) process.stderr.write(`[mcp:${this.config.name}] ${text}\n`);
    });
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const message = rpcResponseSchema.safeParse(parseJson(trimmed));
        if (
          message.success &&
          typeof message.data.id === 'number' &&
          this.pending.has(message.data.id)
        ) {
          const pending = this.pending.get(message.data.id)!;
          this.pending.delete(message.data.id);
          clearTimeout(pending.timer);
          if (message.data.error) pending.reject(new Error(message.data.error.message || 'MCP error'));
          else pending.resolve(message.data.result);
        }
      } catch {
        /* ignore malformed lines */
      }
    });
    child.on('error', (error) => {
      this.rejectAll(error);
    });
    child.on('exit', () => {
      if (!this.closed) this.rejectAll(new Error(`MCP ${this.config.name} exited`));
    });
    await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'auraxis-cli', version: CORE_VERSION },
    }, 10_000);
    this.notify('notifications/initialized', {});
  }

  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: JsonObject }>> {
    const result = await this.request('tools/list', {}, 10_000);
    const value = mcpToolsResultSchema.safeParse(result);
    return value.success
      ? (value.data.tools || []).map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || { type: 'object' },
        }))
      : [];
  }

  async call(tool: string, args: JsonObject): Promise<string> {
    const result = await this.request('tools/call', { name: tool, arguments: args }, 120_000);
    const value = mcpCallResultSchema.safeParse(result);
    const content = value.success ? value.data.content || [] : [];
    const text = content
      .map((part) => (typeof part.text === 'string' ? part.text : JSON.stringify(part)))
      .join('\n');
    if (value.success && value.data.isError) throw new Error(text || 'MCP tool returned an error');
    return text;
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      this.notify('shutdown', {});
    } catch {
      /* server may not support shutdown */
    }
    this.child?.kill('SIGTERM');
  }

  private request(method: string, params: JsonObject, timeoutMs: number): Promise<unknown> {
    const child = this.child;
    if (this.closed || !child) return Promise.reject(new Error('MCP client is not running'));
    const stdin = child.stdin;
    if (!stdin) return Promise.reject(new Error('MCP stdin unavailable'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  private notify(method: string, params: JsonObject): void {
    const child = this.child;
    if (!child || this.closed || !child.stdin) return;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

class HttpMcpClient implements McpTransportClient {
  private readonly controller = new AbortController();
  private closed = false;
  private nextId = 1;

  constructor(private readonly config: McpServerConfig) {
    if (!config.url) throw new Error(`MCP ${config.name} 未配置 url`);
  }

  async start(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'auraxis-cli', version: CORE_VERSION },
    }, 10_000);
    await this.notify('notifications/initialized', {});
  }

  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: JsonObject }>> {
    const result = await this.request('tools/list', {}, 10_000);
    const value = mcpToolsResultSchema.safeParse(result);
    return value.success
      ? (value.data.tools || []).map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || { type: 'object' },
        }))
      : [];
  }

  async call(tool: string, args: JsonObject): Promise<string> {
    const result = await this.request('tools/call', { name: tool, arguments: args }, 120_000);
    const value = mcpCallResultSchema.safeParse(result);
    const content = value.success ? value.data.content || [] : [];
    const text = content
      .map((part) => (typeof part.text === 'string' ? part.text : JSON.stringify(part)))
      .join('\n');
    if (value.success && value.data.isError) throw new Error(text || 'MCP tool returned an error');
    return text;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.controller.abort();
  }

  private async request(method: string, params: JsonObject, timeoutMs: number): Promise<unknown> {
    if (this.closed) throw new Error('MCP HTTP client is not running');
    const id = this.nextId++;
    const response = await fetch(this.config.url!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...this.config.headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}: ${raw.slice(0, 500)}`);
    const message = parseRpcPayload(raw);
    if (message.error) throw new Error(message.error.message || 'MCP HTTP error');
    return message.result;
  }

  private async notify(method: string, params: JsonObject): Promise<void> {
    if (this.closed) return;
    try {
      const response = await fetch(this.config.url!, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...this.config.headers,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method, params }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
      await response.text();
    } catch {
      /* notifications are best-effort */
    }
  }
}

function parseRpcPayload(raw: string): RpcResponse {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('MCP HTTP 返回空响应');
  if (trimmed.startsWith('data:')) {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());
    const payload = lines.filter(Boolean).at(-1) || '';
    if (!payload || payload === '[DONE]') throw new Error('MCP HTTP SSE 没有有效事件');
    const parsed = rpcResponseSchema.safeParse(parseJson(payload));
    if (!parsed.success) throw new Error('MCP HTTP 返回了无效的 JSON-RPC 响应');
    return parsed.data;
  }
  const parsed = rpcResponseSchema.safeParse(parseJson(trimmed));
  if (!parsed.success) throw new Error('MCP HTTP 返回了无效的 JSON-RPC 响应');
  return parsed.data;
}

export class McpManager implements McpHost {
  private clients = new Map<string, McpTransportClient>();
  private definitions = new Map<string, ToolDefinition>();
  private serverByTool = new Map<string, string>();
  readonly errors: string[] = [];

  constructor(private readonly servers: McpServerConfig[]) {}

  async start(): Promise<void> {
    for (const server of this.servers) {
      try {
        const client: McpTransportClient =
          server.transport === 'http' || (!server.command && Boolean(server.url)) ? new HttpMcpClient(server) : new McpClient(server);
        await client.start();
        const tools = await client.listTools();
        this.clients.set(server.name, client);
        for (const tool of tools) {
          const name = toolName(server.name, tool.name);
          this.definitions.set(name, {
            name,
            description: tool.description ? `${tool.description}\n[MCP · ${server.name}]` : `MCP tool from ${server.name}`,
            danger: 'mcp',
            parameters: tool.inputSchema || { type: 'object' },
            mcpServer: server.name,
          });
          this.serverByTool.set(name, server.name);
        }
      } catch (error) {
        this.errors.push(`${server.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  getToolDefinitions(): ToolDefinition[] {
    return [...this.definitions.values()];
  }

  hasTool(name: string): boolean {
    return this.definitions.has(name);
  }

  getDefinition(name: string): ToolDefinition | undefined {
    return this.definitions.get(name);
  }

  async call(serverName: string, toolName: string, args: JsonObject): Promise<string> {
    const client = this.clients.get(serverName);
    if (!client) throw new Error(`MCP server ${serverName} 未连接`);
    const server = this.serverByTool.get(toolName);
    if (server !== serverName) throw new Error('MCP tool server mismatch');
    const rawName = toolName.replace(/^mcp__[^_]+__/, '');
    return client.call(rawName, args);
  }

  async close(): Promise<void> {
    await Promise.all([...this.clients.values()].map((client) => client.close().catch(() => {})));
    this.clients.clear();
  }
}
