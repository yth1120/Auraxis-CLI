import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';

export interface AuraxisClientOptions {
  bin?: string;
  cliPath?: string;
  projectRoot?: string;
  model?: string;
  provider?: string;
  apiFamily?: string;
  apiKey?: string;
  apiBase?: string;
  mode?: string;
  sandbox?: string;
  reasoningEffort?: string;
  toolChoice?: string;
  contextBudget?: number;
  theme?: string;
  visionDetail?: string;
  strictTools?: boolean;
  autoApprove?: boolean;
  approvePlan?: boolean;
  maxTokens?: number;
  maxSteps?: number;
  /** @deprecated 使用 maxSteps。 */
  maxIterations?: number;
  env?: NodeJS.ProcessEnv;
}

export interface AuraxisRunResult {
  text: string;
  iterations: number;
  toolCallCount: number;
}

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

export class AuraxisClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly rl: Interface;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationHandlers = new Set<(method: string, params: Record<string, unknown>) => void>();
  private nextId = 1;
  private closed = false;

  constructor(options: AuraxisClientOptions = {}) {
    const bin = options.bin || 'auraxis';
    const args = ['--app-server'];
    if (options.cliPath) args.unshift(options.cliPath);
    if (options.projectRoot) args.push('--project', options.projectRoot);
    if (options.model) args.push('--model', options.model);
    if (options.provider) args.push('--provider', options.provider);
    if (options.apiFamily) args.push('--api-family', options.apiFamily);
    if (options.apiKey) args.push('--api-key', options.apiKey);
    if (options.apiBase) args.push('--api-base', options.apiBase);
    if (options.mode) args.push('--mode', options.mode);
    if (options.sandbox) args.push('--sandbox', options.sandbox);
    if (options.reasoningEffort) args.push('--reasoning-effort', options.reasoningEffort);
    if (options.toolChoice) args.push('--tool-choice', options.toolChoice);
    if (options.contextBudget) args.push('--context-budget', String(options.contextBudget));
    if (options.theme) args.push('--theme', options.theme);
    if (options.visionDetail) args.push('--vision-detail', options.visionDetail);
    if (options.strictTools) args.push('--strict-tools');
    if (options.autoApprove) args.push('--auto-approve');
    if (options.approvePlan) args.push('--approve-plan');
    if (options.maxTokens) args.push('--max-tokens', String(options.maxTokens));
    const maxSteps = options.maxSteps ?? options.maxIterations;
    if (maxSteps !== undefined) args.push('--max-steps', String(maxSteps));
    this.child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(options.env || {}) },
    });
    this.rl = createInterface({ input: this.child.stdout });
    this.rl.on('line', (line) => this.handleLine(line));
    this.child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    this.child.on('exit', () => {
      this.closed = true;
      const error = new Error('Auraxis app server 已退出');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  onNotification(handler: (method: string, params: Record<string, unknown>) => void): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  async connect(): Promise<void> {
    await this.request('initialize', {});
    await this.request('initialized', {});
  }

  async startThread(): Promise<string> {
    const result = await this.request('thread/start', {});
    const thread = result.thread as Record<string, unknown> | undefined;
    return String(thread?.id || '');
  }

  async resumeThread(threadId: string): Promise<string> {
    const result = await this.request('thread/resume', { threadId });
    const thread = result.thread as Record<string, unknown> | undefined;
    return String(thread?.id || threadId);
  }

  async listThreads(): Promise<Array<Record<string, unknown>>> {
    const result = await this.request('thread/list', {});
    return Array.isArray(result.threads) ? (result.threads as Array<Record<string, unknown>>) : [];
  }

  async forkThread(threadId: string): Promise<string> {
    const result = await this.request('thread/fork', { threadId });
    const thread = result.thread as Record<string, unknown> | undefined;
    return String(thread?.id || '');
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.request('thread/archive', { threadId });
  }

  async run(threadId: string, prompt: string): Promise<AuraxisRunResult> {
    const events: Array<{ method: string; params: Record<string, unknown> }> = [];
    const completed = new Promise<Record<string, unknown>>((resolve, reject) => {
      const remove = this.onNotification((method, params) => {
        events.push({ method, params });
        if (method === 'turn/completed') {
          remove();
          resolve(params);
        }
      });
      setTimeout(() => {
        remove();
        reject(new Error('等待 turn/completed 超时'));
      }, 300_000).unref();
    });
    await this.request('turn/start', { threadId, prompt });
    const result = await completed;
    return {
      text: String(result.text || ''),
      iterations: Number(result.iterations || 0),
      toolCallCount: Number(result.toolCallCount || 0),
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    const shutdown = this.request('shutdown', {}).catch(() => ({}));
    this.child.stdin.end();
    await shutdown.catch(() => undefined);
    this.closed = true;
  }

  private async request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`SDK 请求超时: ${method}`));
      }, 300_000);
      const originalResolve = resolve;
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          originalResolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  private handleLine(line: string): void {
    try {
      const message = JSON.parse(line) as {
        id?: number;
        result?: Record<string, unknown>;
        error?: { message?: string };
        method?: string;
        params?: Record<string, unknown>;
      };
      if (typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error.message || 'SDK 请求失败'));
          else pending.resolve(message.result || {});
        }
        return;
      }
      if (message.method) {
        for (const handler of [...this.notificationHandlers]) {
          handler(message.method, message.params || {});
        }
      }
    } catch {
      // 忽略非 JSON 行
    }
  }
}
