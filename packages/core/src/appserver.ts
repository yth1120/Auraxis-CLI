import path from 'node:path';
import { getAppPaths } from './config.js';
import { runAgent } from './engine/agent.js';
import { getTools } from './tools/registry.js';
import { McpManager } from './mcp/manager.js';
import { loadMcpServers } from './config.js';
import { SessionStore } from './session/store.js';
import type {
  ApiFamily,
  ChatMessage,
  ImageDetail,
  JsonObject,
  ModelProvider,
  PermissionRequest,
  Plan,
  ReasoningEffort,
  SandboxMode,
  ToolChoice,
} from './types.js';
import type { ApprovalPolicy } from './types.js';

export interface AppServerOptions {
  projectRoot: string;
  model: string;
  provider: ModelProvider;
  apiFamily?: ApiFamily;
  apiKey: string;
  apiBase: string;
  headers?: Record<string, string>;
  supportsImages?: boolean;
  mode: ApprovalPolicy;
  sandboxMode: SandboxMode;
  reasoningEffort: ReasoningEffort;
  toolChoice: ToolChoice;
  visionDetail?: ImageDetail;
  strictTools?: boolean;
  maxTokens?: number;
  maxSteps?: number;
  /** @deprecated 使用 maxSteps。 */
  maxIterations?: number;
  contextBudget?: number;
  autoApprove?: boolean;
  approvePlan?: boolean;
}

export interface AppThread {
  id: string;
  sessionId: string;
  messages: ChatMessage[];
  summary?: string;
  provider: ModelProvider;
  model: string;
  apiFamily?: ApiFamily;
  headers?: Record<string, string>;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: JsonObject | unknown;
}

export class AppServer {
  private readonly threads = new Map<string, AppThread>();
  private readonly outputs: string[] = [];
  private mcp: McpManager | null = null;
  private readonly sessionStore: SessionStore;

  constructor(private readonly options: AppServerOptions) {
    this.sessionStore = new SessionStore({ dir: path.join(getAppPaths().sessionsDir) });
  }

  async start(): Promise<void> {
    this.mcp = new McpManager(await loadMcpServers(this.options.projectRoot));
    await this.mcp.start();
  }

  async close(): Promise<void> {
    await this.mcp?.close().catch(() => {});
    this.mcp = null;
  }

  async handleLine(line: string): Promise<string[]> {
    this.outputs.length = 0;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.pushResponse(null, null, { code: -32700, message: 'Parse error' });
      return [...this.outputs];
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.pushResponse(null, null, { code: -32600, message: 'Invalid Request' });
      return [...this.outputs];
    }
    const request = parsed as JsonRpcRequest;
    try {
      const result = await this.dispatch(request.method || '', request.params);
      if (request.id !== undefined && request.id !== null) {
        this.pushResponse(request.id, result ?? {});
      }
    } catch (error) {
      if (request.id !== undefined && request.id !== null) {
        this.pushResponse(request.id, null, {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return [...this.outputs];
  }

  private pushResponse(id: string | number | null, result: unknown, error?: { code: number; message: string }): void {
    this.outputs.push(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        ...(error ? { error } : { result: result ?? {} }),
      }),
    );
  }

  private emit(method: string, params: unknown): void {
    this.outputs.push(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    const input = params && typeof params === 'object' ? (params as JsonObject) : {};
    if (method === 'initialize') {
      return {
        protocolVersion: '1',
        capabilities: {},
        serverInfo: {
          name: 'Auraxis App Server',
          version: '1.0.0',
        },
      };
    }
    if (method === 'initialized') return null;
    if (method === 'shutdown') return { ok: true };
    if (method === 'ping') return { ok: true };
    if (method === 'thread/list') {
      const sessions = await this.sessionStore.list();
      return {
        threads: sessions.map((item) => ({
          id: item.id,
          projectRoot: item.projectRoot,
          model: item.model,
          provider: item.provider,
          updatedAt: item.updatedAt,
        })),
      };
    }
    if (method === 'thread/start') {
      const session = await this.sessionStore.create(this.options.projectRoot, this.options.model, this.options.provider);
      const thread: AppThread = {
        id: session.id,
        sessionId: session.id,
        messages: [],
        provider: this.options.provider,
        model: this.options.model,
        apiFamily: this.options.apiFamily,
        headers: this.options.headers,
      };
      this.threads.set(thread.id, thread);
      this.emit('thread/started', { threadId: thread.id });
      return { thread: { id: thread.id } };
    }
    if (method === 'thread/resume') {
      const key = String(input.threadId || input.id || '');
      const session = await this.sessionStore.load(key);
      if (!session) throw new Error(`未知会话: ${key}`);
      const thread: AppThread = {
        id: session.id,
        sessionId: session.id,
        messages: session.messages,
        summary: session.summary,
        provider: session.provider || this.options.provider,
        model: session.model,
        apiFamily: this.options.apiFamily,
        headers: this.options.headers,
      };
      this.threads.set(thread.id, thread);
      return { thread: { id: thread.id, messages: thread.messages.length } };
    }
    if (method === 'thread/fork') {
      const source = String(input.threadId || '');
      const sourceThread = this.threads.get(source);
      const session = sourceThread
        ? await this.sessionStore.load(sourceThread.sessionId)
        : await this.sessionStore.load(source);
      if (!session) throw new Error(`未知会话: ${source}`);
      const fork = await this.sessionStore.create(
        session.projectRoot,
        session.model,
        session.provider || this.options.provider,
      );
      const thread: AppThread = {
        id: fork.id,
        sessionId: fork.id,
        messages: session.messages,
        summary: session.summary,
        provider: session.provider || this.options.provider,
        model: session.model,
        apiFamily: sourceThread?.apiFamily || this.options.apiFamily,
        headers: sourceThread?.headers || this.options.headers,
      };
      this.threads.set(thread.id, thread);
      this.emit('thread/forked', { threadId: thread.id, sourceThreadId: source });
      return { thread: { id: thread.id } };
    }
    if (method === 'turn/start') {
      const threadId = String(input.threadId || '');
      const thread = this.threads.get(threadId);
      if (!thread) throw new Error(`未知线程: ${threadId}`);
      const promptValue = input.prompt ?? input.input;
      const prompt = typeof promptValue === 'string' ? promptValue : '';
      if (!prompt.trim()) throw new Error('prompt/input 不能为空');
      const turnId = `${threadId}-${Date.now().toString(36)}`;
      this.emit('turn/started', { turnId, threadId });
      const result = await runAgent({
        prompt,
        projectRoot: this.options.projectRoot,
        model: thread.model,
        provider: thread.provider,
        apiFamily: thread.apiFamily,
        apiKey: this.options.apiKey,
        apiBase: this.options.apiBase,
        headers: thread.headers,
        supportsImages: this.options.supportsImages,
        mode: this.options.mode,
        sandboxMode: this.options.sandboxMode,
        maxTokens: this.options.maxTokens,
        maxSteps: this.options.maxSteps ?? this.options.maxIterations,
        contextBudget: this.options.contextBudget,
        reasoningEffort: this.options.reasoningEffort,
        toolChoice: this.options.toolChoice,
        visionDetail: this.options.visionDetail,
        strictTools: this.options.strictTools,
        tools: [...getTools(), ...(this.mcp?.getToolDefinitions() || [])],
        mcp: this.mcp || undefined,
        sessionId: thread.sessionId,
        resumeMessages: thread.messages,
        signal: new AbortController().signal,
        onEvent: (event) => this.emitAppEvent(event),
        requestPermission: async (_request: PermissionRequest) =>
          this.options.autoApprove || this.options.mode === 'auto' ? 'allow_once' : 'deny',
        onPlanApproval: async (_plan: Plan) => (this.options.approvePlan ? 'approve' : 'reject'),
        askUser: async () => '',
      });
      const session = await this.sessionStore.load(thread.sessionId);
      if (session) {
        session.messages = result.messages;
        session.summary = result.text.slice(0, 500);
        session.model = thread.model;
        session.provider = thread.provider;
        await this.sessionStore.save(session);
      }
      thread.messages = result.messages;
      thread.summary = result.text.slice(0, 500);
      this.emit('turn/completed', {
        turnId,
        threadId,
        status: result.aborted ? 'aborted' : 'completed',
        text: result.text,
        iterations: result.iterations,
        toolCallCount: result.toolCallCount,
      });
      return { turnId, ok: true };
    }
    if (method === 'thread/archive') {
      const id = String(input.threadId || '');
      this.threads.delete(id);
      return { ok: true };
    }
    throw new Error(`Unknown method: ${method}`);
  }

  private emitAppEvent(event: unknown): void {
    const item = event as {
      type?: string;
      text?: string;
      chunk?: string;
      toolName?: string;
      durationMs?: number;
      ok?: boolean;
      error?: string;
      inputTokens?: number;
      outputTokens?: number;
      reasoningTokens?: number;
      result?: string;
    };
    switch (item.type) {
      case 'text_chunk':
        this.emit('item/agentMessage/delta', { text: item.text || '' });
        break;
      case 'thinking_chunk':
        this.emit('item/reasoning/delta', { text: item.chunk || '' });
        break;
      case 'tool_start':
        this.emit('item/tool/started', { name: item.toolName });
        break;
      case 'tool_end':
        this.emit('item/tool/completed', { name: item.toolName, durationMs: item.durationMs, ok: item.ok });
        break;
      case 'tool_error':
        this.emit('item/tool/error', { name: item.toolName, error: item.error });
        break;
      case 'plan_created':
        this.emit('item/plan/created', {});
        break;
      case 'usage':
        this.emit('item/usage', {
          inputTokens: item.inputTokens,
          outputTokens: item.outputTokens,
          reasoningTokens: item.reasoningTokens,
        });
        break;
      case 'done':
        this.emit('item/agentMessage/completed', { text: item.result || '' });
        break;
      case 'error':
        this.emit('item/error', { error: item.error });
        break;
      default:
        break;
    }
  }
}
