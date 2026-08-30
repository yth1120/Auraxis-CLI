import type {
  ChatMessage,
  JsonObject,
  LlmClient,
  LlmRequest,
  LlmResult,
  LlmToolCall,
  LlmUsage,
  ToolChoice,
} from './types.js';
import type { z } from 'zod';
import {
  asJsonObject,
  deepseekResponseSchema,
  deepseekStreamPageSchema,
  deepseekToolCallSchema,
  parseJson,
} from './validation.js';

export class DeepSeekClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly apiBase: string,
    private readonly model: string,
    private readonly defaultMaxTokens = 32768,
    private readonly maxRetries = 3,
    private readonly keepReasoningContent = false,
    private readonly strictTools = false,
    private readonly headers?: Record<string, string>,
  ) {}

  async chat(request: LlmRequest): Promise<LlmResult> {
    if (!this.apiKey) throw new Error('未配置 API Key');
    let emitted = false;
    const requestWithEmitTracking: LlmRequest = {
      ...request,
      onTextChunk: (text) => {
        emitted = true;
        request.onTextChunk?.(text);
      },
      onThinkingChunk: (text, isNewBlock) => {
        emitted = true;
        request.onThinkingChunk?.(text, isNewBlock);
      },
      onUsage: (usage) => {
        emitted = true;
        request.onUsage?.(usage);
      },
    };
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      try {
        return request.stream === false
          ? await this.chatOnce(requestWithEmitTracking)
          : await this.chatStream(requestWithEmitTracking);
      } catch (error) {
        if (request.signal?.aborted || emitted || attempt === this.maxRetries || !isRetryableError(error)) {
          throw error;
        }
        await delay(500 * 2 ** (attempt - 1));
      }
    }
    throw new Error('API 重试次数已耗尽');
  }

  async completePrefix(
    input: { prefix: string; maxTokens?: number; stop?: string | string[]; signal?: AbortSignal },
  ): Promise<string> {
    if (!this.apiKey) throw new Error('未配置 API Key');
    const response = await fetch(betaEndpoint(this.apiBase), {
      method: 'POST',
      headers: {
        ...this.headers,
        'content-type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'user', content: '请补全下面的内容，只输出补全结果。' },
          { role: 'assistant', content: input.prefix, prefix: true },
        ],
        max_tokens: input.maxTokens ?? 2048,
        ...(input.stop ? { stop: input.stop } : {}),
        stream: false,
      }),
      signal: input.signal,
    });
    const json = await parseResponse(response);
    return json.choices?.[0]?.message?.content || '';
  }

  async completeFim(
    input: { prompt: string; suffix?: string; maxTokens?: number; signal?: AbortSignal },
  ): Promise<string> {
    if (!this.apiKey) throw new Error('未配置 API Key');
    const response = await fetch(fimEndpoint(this.apiBase), {
      method: 'POST',
      headers: {
        ...this.headers,
        'content-type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        prompt: input.prompt,
        ...(input.suffix ? { suffix: input.suffix } : {}),
        max_tokens: input.maxTokens ?? 1024,
        stream: false,
      }),
      signal: input.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`FIM API ${response.status}: ${body.slice(0, 500)}`);
    }
    const json = asJsonObject(parseJson(await response.text()));
    const choices = Array.isArray(json.choices) ? json.choices.map((item) => asJsonObject(item)) : [];
    const first = asJsonObject(choices[0]);
    return typeof first.text === 'string' ? first.text : '';
  }

  private buildBody(request: LlmRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages.map((message) => {
        const preserveReasoning =
          this.keepReasoningContent &&
          (request.tools !== undefined || Boolean(message.tool_calls?.length));
        const wire = asJsonObject(sanitizeOutboundMessage(message, preserveReasoning));
        if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
          wire.tool_calls = message.tool_calls.map((call) => ({
            id: call.id,
            type: 'function',
            function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
          }));
        }
        return wire;
      }),
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      stream,
    };
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters:
            this.strictTools && tool.strict !== false
              ? normalizeStrictSchema(tool.parameters)
              : tool.parameters,
          ...(this.strictTools && tool.strict !== false ? { strict: true } : {}),
        },
      }));
      body.tool_choice = this.normalizeToolChoice(request.toolChoice);
    }
    if (request.reasoningEffort) {
      body.thinking = { type: 'enabled' };
      body.reasoning_effort = request.reasoningEffort;
    }
    if (request.temperature !== undefined) {
      body.temperature = request.temperature;
    }
    if (request.responseFormat === 'json_object') {
      body.response_format = { type: 'json_object' };
    }
    return body;
  }

  private normalizeToolChoice(value?: ToolChoice): unknown {
    if (value === 'none' || value === 'required' || value === 'auto' || value === undefined) return value || 'auto';
    if (value && value !== 'auto') return value;
    return 'auto';
  }

  private async chatOnce(request: LlmRequest): Promise<LlmResult> {
    const response = await fetch(this.apiBase, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(this.buildBody(request, false)),
      signal: request.signal,
    });
    const json = await parseResponse(response);
    const choice = json.choices?.[0];
    const message = choice?.message;
    const usage = json.usage;
    const result: LlmResult = {
      content: message?.content || '',
      reasoning: message?.reasoning_content || '',
      toolCalls: parseMessageToolCalls(message?.tool_calls),
      usage: usage ? mapUsage(usage) : undefined,
      finishReason: choice?.finish_reason,
    };
    request.onTextChunk?.(result.content);
    if (result.reasoning) request.onThinkingChunk?.(result.reasoning, true);
    if (result.usage) request.onUsage?.(result.usage);
    return result;
  }

  private async chatStream(request: LlmRequest): Promise<LlmResult> {
    const response = await fetch(this.apiBase, {
      method: 'POST',
      headers: {
        ...this.headers,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(this.buildBody(request, true)),
      signal: request.signal,
    });
    if (!response.body) throw new Error('DeepSeek 返回空流');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let text = '';
    let reasoning = '';
    let finishReason: string | undefined;
    let usage: LlmUsage | undefined;
    const inFlight = new Map<number, { id: string; name: string; args: string }>();
    let inReasoningBlock = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        const parsed = deepseekStreamPageSchema.safeParse(parseJson(payload));
        if (!parsed.success) continue;
        const page = parsed.data;
        if (page.usage) {
          usage = mapUsage(page.usage);
          request.onUsage?.(usage);
        }
        const choice = page.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta || {};
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          if (!inReasoningBlock) {
            inReasoningBlock = true;
            request.onThinkingChunk?.('', true);
          }
          reasoning += delta.reasoning_content;
          request.onThinkingChunk?.(delta.reasoning_content, false);
        }
        if (typeof delta.content === 'string' && delta.content) {
          if (inReasoningBlock) inReasoningBlock = false;
          text += delta.content;
          request.onTextChunk?.(delta.content);
        }
        if (Array.isArray(delta.tool_calls)) {
          if (inReasoningBlock) inReasoningBlock = false;
          for (const raw of delta.tool_calls) {
            const call = raw;
            const index = call.index ?? 0;
            const current = inFlight.get(index) || { id: `call_${index}_${Date.now()}`, name: '', args: '' };
            if (call.id) current.id = call.id;
            const fn = call.function;
            if (fn?.name) current.name = fn.name;
            if (fn?.arguments) current.args += fn.arguments;
            inFlight.set(index, current);
          }
        }
      }
    }

    const toolCalls = [...inFlight.values()]
      .filter((call) => call.name)
      .map((call) => {
        let args: Record<string, unknown> = {};
        const parsedArgs = parseJson(call.args || '{}');
        args =
          parsedArgs && typeof parsedArgs === 'object' && !Array.isArray(parsedArgs)
            ? asJsonObject(parsedArgs)
            : { raw: call.args || '' };
        return { id: call.id, name: call.name, args };
      });

    return {
      content: text,
      reasoning,
      toolCalls,
      usage,
      finishReason,
    };
  }
}

function sanitizeOutboundMessage(message: ChatMessage, preserveReasoning = false): ChatMessage {
  if (message.role === 'assistant') {
    const { reasoning_content: _reasoning, ...rest } = message;
    return preserveReasoning && _reasoning ? { ...rest, reasoning_content: _reasoning } : rest;
  }
  return message;
}

function betaEndpoint(apiBase: string): string {
  let endpoint = apiBase.replace(/\/+$/, '');
  endpoint = endpoint.replace(/\/responses$/, '');
  endpoint = endpoint.replace(/\/anthropic\/v1\/messages$/, '');
  if (/\/beta\/chat\/completions$/.test(endpoint)) return endpoint;
  if (/\/chat\/completions$/.test(endpoint)) return endpoint.replace(/\/chat\/completions$/, '/beta/chat/completions');
  return `${endpoint}/beta/chat/completions`;
}

function fimEndpoint(apiBase: string): string {
  let endpoint = apiBase.replace(/\/+$/, '');
  endpoint = endpoint.replace(/\/responses$/, '');
  endpoint = endpoint.replace(/\/anthropic\/v1\/messages$/, '');
  if (/\/beta\/completions$/.test(endpoint)) return endpoint;
  if (/\/chat\/completions$/.test(endpoint) || /\/beta\/chat\/completions$/.test(endpoint)) {
    return endpoint.replace(/(\/beta)?\/chat\/completions$/, '/beta/completions');
  }
  return `${endpoint}/beta/completions`;
}

export function normalizeStrictSchema(schema: JsonObject): JsonObject {
  const copy = { ...schema };
  const type = typeof copy.type === 'string' ? copy.type : undefined;
  if (type === 'object') {
    copy.additionalProperties = false;
    const properties = asJsonObject(copy.properties);
    const required = Array.isArray(copy.required) ? copy.required.map(String) : [];
    for (const key of Object.keys(properties)) {
      const value = asJsonObject(properties[key]);
      properties[key] = normalizeStrictSchema(value);
      if (!required.includes(key)) required.push(key);
    }
    copy.properties = properties;
    if (required.length) copy.required = required;
    else delete copy.required;
  }
  if (type === 'array') {
    delete copy.minItems;
    delete copy.maxItems;
    if (copy.items && typeof copy.items === 'object') {
      copy.items = normalizeStrictSchema(asJsonObject(copy.items));
    }
  }
  if (type === 'string') {
    delete copy.minLength;
    delete copy.maxLength;
  }
  for (const branchKey of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(copy[branchKey])) {
      copy[branchKey] = copy[branchKey].map((item) =>
        item && typeof item === 'object' ? normalizeStrictSchema(asJsonObject(item)) : item,
      );
    }
  }
  if (copy.$def && typeof copy.$def === 'object') {
    const definitions = asJsonObject(copy.$def);
    for (const key of Object.keys(definitions)) {
      definitions[key] = normalizeStrictSchema(asJsonObject(definitions[key]));
    }
    copy.$def = definitions;
  }
  return copy;
}

async function parseResponse(response: Response): Promise<z.infer<typeof deepseekResponseSchema>> {
  if (!response.ok) {
    const body = await response.text();
    throw new DeepSeekHttpError(response.status, `API ${response.status}: ${body.slice(0, 500)}`);
  }
  const body = await response.text();
  const parsed = deepseekResponseSchema.safeParse(parseJson(body));
  if (!parsed.success) {
    throw new Error(`API 返回了无法解析的 JSON: ${parsed.error.issues[0]?.message || 'unknown error'}`);
  }
  return parsed.data;
}

class DeepSeekHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'DeepSeekHttpError';
  }
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof DeepSeekHttpError) {
    return error.status === 429 || error.status >= 500;
  }
  if (!(error instanceof Error)) return false;
  return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network error/i.test(error.message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMessageToolCalls(raw: unknown): LlmToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item) => {
      const parsed = deepseekToolCallSchema.safeParse(item);
      if (!parsed.success) return [];
      const name = parsed.data.function?.name || '';
      const parsedArgs = parseJson(parsed.data.function?.arguments || '{}');
      const args =
        parsedArgs && typeof parsedArgs === 'object' && !Array.isArray(parsedArgs)
          ? asJsonObject(parsedArgs)
          : { raw: parsed.data.function?.arguments || '' };
      return [{
        id: parsed.data.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        name,
        args,
      }];
    })
    .filter((call) => call.name);
}

function mapUsage(raw: unknown): LlmUsage {
  const usage = asJsonObject(raw);
  const details = asJsonObject(usage.completion_tokens_details);
  const inputTokens = Number(usage.prompt_tokens ?? 0);
  const outputTokens = Number(usage.completion_tokens ?? 0);
  return {
    inputTokens,
    outputTokens,
    reasoningTokens: typeof details.reasoning_tokens === 'number' ? details.reasoning_tokens : undefined,
    cacheHitTokens: typeof usage.prompt_cache_hit_tokens === 'number' ? usage.prompt_cache_hit_tokens : undefined,
    cacheMissTokens: typeof usage.prompt_cache_miss_tokens === 'number' ? usage.prompt_cache_miss_tokens : undefined,
  };
}
