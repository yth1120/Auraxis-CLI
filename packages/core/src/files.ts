import type {
  FileListResult,
  FilesClient,
  ModelProvider,
  UploadedFile,
} from './types.js';
import { asJsonObject, parseJson } from './validation.js';

export interface DeepSeekFilesOptions {
  provider?: ModelProvider;
  apiKey: string;
  apiBase: string;
  headers?: Record<string, string>;
}

export class DeepSeekFilesClient implements FilesClient {
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly headers?: Record<string, string>;

  constructor(options: DeepSeekFilesOptions) {
    this.apiKey = options.apiKey;
    this.apiBase = normalizeFilesBase(options.apiBase);
    this.headers = options.headers;
  }

  async upload(
    file: { name: string; buffer: Buffer; mimeType: string },
    options: { purpose?: string; expiresAfterSeconds?: number } = {},
  ): Promise<UploadedFile> {
    if (!this.apiKey) throw new Error('未配置 DeepSeek API Key');
    const form = new FormData();
    form.append('purpose', options.purpose || 'user_data');
    form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.name);
    if (options.expiresAfterSeconds) {
      form.append('expires_after[anchor]', 'created_at');
      form.append('expires_after[seconds]', String(options.expiresAfterSeconds));
    }
    const response = await fetch(`${this.apiBase}/files`, {
      method: 'POST',
      headers: {
        ...this.headers,
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: form,
    });
    return parseFileResponse(await parseFilesResponse(response), '上传');
  }

  async list(
    options: { after?: string; limit?: number; order?: 'asc' | 'desc'; purpose?: string } = {},
  ): Promise<FileListResult> {
    if (!this.apiKey) throw new Error('未配置 DeepSeek API Key');
    const params = new URLSearchParams();
    if (options.after) params.set('after', options.after);
    if (options.limit) params.set('limit', String(Math.max(1, Math.min(1000, Math.floor(options.limit)))));
    if (options.order) params.set('order', options.order);
    if (options.purpose) params.set('purpose', options.purpose);
    const query = params.toString();
    const response = await fetch(`${this.apiBase}/files${query ? `?${query}` : ''}`, {
      headers: { ...this.headers, Authorization: `Bearer ${this.apiKey}` },
    });
    const json = await parseFilesResponse(response);
    const data = Array.isArray(json.data) ? json.data.slice(0, 1000).map((item) => parseFileResponse(asJsonObject(item), '列表')) : [];
    return {
      data,
      first_id: typeof json.first_id === 'string' ? json.first_id : undefined,
      last_id: typeof json.last_id === 'string' ? json.last_id : undefined,
      has_more: json.has_more === true,
    };
  }

  async retrieve(id: string): Promise<UploadedFile> {
    if (!this.apiKey) throw new Error('未配置 DeepSeek API Key');
    const response = await fetch(`${this.apiBase}/files/${encodeURIComponent(id)}`, {
      headers: { ...this.headers, Authorization: `Bearer ${this.apiKey}` },
    });
    return parseFileResponse(await parseFilesResponse(response), '查询');
  }

  async delete(id: string): Promise<{ id: string; deleted: boolean }> {
    if (!this.apiKey) throw new Error('未配置 DeepSeek API Key');
    const response = await fetch(`${this.apiBase}/files/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { ...this.headers, Authorization: `Bearer ${this.apiKey}` },
    });
    const json = await parseFilesResponse(response);
    return {
      id: typeof json.id === 'string' ? json.id : id,
      deleted: json.deleted === true || json.type === 'file_deleted',
    };
  }
}

export function createDeepSeekFilesClient(options: DeepSeekFilesOptions): FilesClient {
  return new DeepSeekFilesClient(options);
}

function normalizeFilesBase(apiBase: string): string {
  let base = apiBase.replace(/\/+$/, '');
  base = base.replace(/\/beta\/chat\/completions$/, '');
  base = base.replace(/\/chat\/completions$/, '');
  base = base.replace(/\/responses$/, '');
  base = base.replace(/\/anthropic\/v1\/messages$/, '');
  return base;
}

async function parseFilesResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Files API ${response.status}: ${body.slice(0, 500)}`);
  }
  const parsed = parseJson(body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Files API 返回了无法解析的 JSON');
  }
  return asJsonObject(parsed);
}

function parseFileResponse(json: Record<string, unknown>, action: string): UploadedFile {
  if (typeof json.id !== 'string' || !json.id) {
    throw new Error(`Files API ${action}失败: 缺少文件 ID`);
  }
  return {
    id: json.id,
    object: typeof json.object === 'string' ? json.object : undefined,
    bytes: Number(json.bytes || json.size_bytes || 0),
    created_at:
      typeof json.created_at === 'number'
        ? json.created_at
        : typeof json.created_at === 'string'
          ? Date.parse(json.created_at) / 1000
          : undefined,
    filename: typeof json.filename === 'string' ? json.filename : undefined,
    purpose: typeof json.purpose === 'string' ? json.purpose : undefined,
    expires_at: typeof json.expires_at === 'number' ? json.expires_at : undefined,
  };
}
