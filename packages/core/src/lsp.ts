import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { safeProcessEnv } from './safe-env.js';
import {
  parseJson,
  parseJsonObject,
  parseJsonStringArray,
  rpcResponseSchema,
} from './validation.js';

export class LspManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private closed = false;
  private stderr = '';

  private constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly projectRoot: string,
  ) {}

  static async fromEnv(projectRoot: string): Promise<LspManager | null> {
    const command = process.env.AURAXIS_LSP_COMMAND;
    if (!command) return null;
    let args: string[] = [];
    try {
      const raw = process.env.AURAXIS_LSP_ARGS;
      if (raw) args = parseJsonStringArray(raw) || [];
    } catch {
      args = [];
    }
    if (process.env.AURAXIS_LSP_DEBUG === '1') {
      process.stderr.write(`[LSP] command=${command} args=${JSON.stringify(args)}\n`);
    }
    const manager = new LspManager(command, args, projectRoot);
    try {
      await manager.start();
      return manager;
    } catch (error) {
      await manager.close();
      if (process.env.AURAXIS_LSP_DEBUG === '1') {
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[LSP] ${detail}\n`);
      }
      return null;
    }
  }

  async start(): Promise<void> {
    if (this.closed) throw new Error('LSP client already closed');
    const shell = this.args.length === 0 && /\s/.test(this.command);
    const child = spawn(this.command, this.args, {
      cwd: this.projectRoot,
      shell,
      windowsHide: true,
      env: safeProcessEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-4000);
    });
    child.stdout.on('data', (chunk) => {
      if (process.env.AURAXIS_LSP_DEBUG === '1') {
        process.stderr.write(`[LSP] recv ${JSON.stringify(String(chunk).slice(0, 500))}\n`);
      }
      this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))]);
      this.drain();
    });
    child.on('error', (error) => this.rejectAll(error));
    child.on('close', () => {
      if (!this.closed) {
        const detail = this.stderr.trim();
        this.rejectAll(new Error(detail ? `LSP server exited: ${detail}` : 'LSP server exited'));
      }
    });
    const rawInitializationOptions = process.env.AURAXIS_LSP_INIT_OPTIONS;
    const initializationOptions = rawInitializationOptions ? parseJsonObject(rawInitializationOptions) || {} : {};
    await this.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(`${this.projectRoot}/`).href,
      capabilities: {},
      initializationOptions,
    }, 15_000);
    await this.notify('initialized', {});
  }

  async definition(file: string, line: number, column: number): Promise<unknown> {
    await this.open(file);
    return this.request('textDocument/definition', {
      textDocument: { uri: pathToFileURL(file).href },
      position: { line: Math.max(0, line - 1), character: Math.max(0, column - 1) },
    }, 15_000);
  }

  async references(file: string, line: number, column: number): Promise<unknown> {
    await this.open(file);
    return this.request('textDocument/references', {
      textDocument: { uri: pathToFileURL(file).href },
      position: { line: Math.max(0, line - 1), character: Math.max(0, column - 1) },
      context: { includeDeclaration: true },
    }, 15_000);
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.notify('shutdown', {});
    } catch {
      /* best effort */
    }
    this.child?.kill('SIGTERM');
    this.child = null;
  }

  private async open(file: string): Promise<void> {
    const content = await fsp.readFile(file, 'utf8').catch(() => '');
    await this.notify('textDocument/didOpen', {
      textDocument: {
        uri: pathToFileURL(file).href,
        languageId: path.extname(file).slice(1) || 'plaintext',
        version: 1,
        text: content.slice(0, 512_000),
      },
    });
  }

  private request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const child = this.child;
    if (!child || this.closed) return Promise.reject(new Error('LSP client is not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        writeFrame(child, { jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async notify(method: string, params: Record<string, unknown>): Promise<void> {
    const child = this.child;
    if (!child || this.closed) return;
    try {
      writeFrame(child, { jsonrpc: '2.0', method, params });
    } catch {
      /* server may have exited */
    }
  }

  private drain(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const headers = this.buffer.subarray(0, headerEnd).toString('utf8');
      const match = /content-length:\s*(\d+)/i.exec(headers);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;
      const raw = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.subarray(bodyStart + length);
      try {
        const message = rpcResponseSchema.safeParse(parseJson(raw));
        if (
          message.success &&
          typeof message.data.id === 'number' &&
          this.pending.has(message.data.id)
        ) {
          const pending = this.pending.get(message.data.id)!;
          this.pending.delete(message.data.id);
          clearTimeout(pending.timer);
          if (message.data.error) pending.reject(new Error(message.data.error.message || 'LSP request failed'));
          else pending.resolve(message.data.result);
        }
      } catch {
        /* malformed frame */
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function writeFrame(child: ChildProcessWithoutNullStreams, message: Record<string, unknown>): void {
  const body = JSON.stringify(message);
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}
