import { DeepSeekClient } from './llm.js';
import { ResponsesClient } from './responses.js';
import type {
  ApiFamily,
  ChatMessage,
  JsonObject,
  LlmClient,
  LlmRequest,
  LlmResult,
  LlmToolCall,
  ModelProvider,
  ToolChoice,
} from './types.js';
import { asJsonObject, parseJson } from './validation.js';

export interface ModelClientConfig {
  provider: ModelProvider;
  apiFamily?: ApiFamily;
  model: string;
  apiKey: string;
  apiBase: string;
  maxTokens?: number;
  maxRetries?: number;
  strictTools?: boolean;
  headers?: Record<string, string>;
}

export function createLlmClient(config: ModelClientConfig): LlmClient {
  if (config.provider === 'gemini') {
    return new GeminiClient(config.apiKey, config.apiBase, config.model, config.maxTokens, config.maxRetries, config.headers);
  }
  if (config.provider === 'anthropic' || config.apiFamily === 'anthropic') {
    return new AnthropicClient(config.apiKey, config.apiBase, config.model, config.maxTokens, config.maxRetries, config.headers);
  }
  if (config.apiFamily === 'responses') {
    return new ResponsesClient(config.apiKey, config.apiBase, config.model, config.maxTokens, config.maxRetries, config.headers);
  }
  const deepSeekCompatible =
    config.provider === 'deepseek' || /api\.deepseek\.com/i.test(config.apiBase);
  return new DeepSeekClient(
    config.apiKey,
    config.apiBase,
    config.model,
    config.maxTokens,
    config.maxRetries,
    deepSeekCompatible,
    config.strictTools === true,
    config.headers,
  );
}

function chatText(content?: string | ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

abstract class RetryingClient implements LlmClient {
  constructor(
    protected readonly apiKey: string,
    protected readonly apiBase: string,
    protected readonly model: string,
    protected readonly maxTokens = 32768,
    protected readonly maxRetries = 3,
    protected readonly headers?: Record<string, string>,
  ) {}

  abstract chatOnce(request: LlmRequest): Promise<LlmResult>;

  async chat(request: LlmRequest): Promise<LlmResult> {
    if (!this.apiKey) throw new Error(`未配置 ${this.providerName()} API Key`);
    let emitted = false;
    const tracked: LlmRequest = {
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
        const result = await this.chatOnce(tracked);
        if (result.content) request.onTextChunk?.(result.content);
        if (result.reasoning) request.onThinkingChunk?.(result.reasoning, true);
        if (result.usage) request.onUsage?.(result.usage);
        return result;
      } catch (error) {
        if (request.signal?.aborted || emitted || attempt === this.maxRetries || !isRetryable(error)) throw error;
        await delay(500 * 2 ** (attempt - 1));
      }
    }
    throw new Error(`${this.providerName()} API 重试次数已耗尽`);
  }

  protected abstract providerName(): string;
}

class AnthropicClient extends RetryingClient {
  protected providerName(): string {
    return 'Anthropic';
  }

  async chatOnce(request: LlmRequest): Promise<LlmResult> {
    const { system, messages } = toAnthropicMessages(request.messages);
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxTokens ?? this.maxTokens,
      messages,
    };
    if (system) body.system = system;
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
      body.tool_choice = toAnthropicToolChoice(request.toolChoice);
    }
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.reasoningEffort) {
      body.thinking = { type: 'enabled', budget_tokens: 4096 };
      if (/api\.deepseek\.com\/anthropic/i.test(this.apiBase)) {
        body.output_config = { effort: request.reasoningEffort };
      }
    }
    const response = await fetch(this.apiBase, {
      method: 'POST',
      headers: {
        ...this.headers,
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });
    const json = await parseProviderResponse(response, 'Anthropic');
    const content = Array.isArray(json.content) ? json.content.map((part) => asJsonObject(part)) : [];
    let text = '';
    let reasoning = '';
    const toolCalls: LlmToolCall[] = [];
    for (const part of content) {
      if (part.type === 'text' && typeof part.text === 'string') text += part.text;
      if (part.type === 'thinking' && typeof part.thinking === 'string') reasoning += part.thinking;
      if (part.type === 'tool_use' && typeof part.name === 'string') {
        toolCalls.push({
          id: typeof part.id === 'string' ? part.id : `tool_${toolCalls.length + 1}`,
          name: part.name,
          args: (part.input || {}) as JsonObject,
        });
      }
    }
    const usage = asJsonObject(json.usage);
    return {
      content: text,
      reasoning,
      toolCalls,
      usage: Object.keys(usage).length
        ? { inputTokens: Number(usage.input_tokens || 0), outputTokens: Number(usage.output_tokens || 0) }
        : undefined,
      finishReason: typeof json.stop_reason === 'string' ? json.stop_reason : undefined,
    };
  }
}

class GeminiClient extends RetryingClient {
  protected providerName(): string {
    return 'Gemini';
  }

  async chatOnce(request: LlmRequest): Promise<LlmResult> {
    const { systemInstruction, contents } = toGeminiContents(request.messages);
    const body: Record<string, unknown> = {
      contents,
    };
    if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
    if (request.tools?.length) {
      body.tools = [{ functionDeclarations: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })) }];
      body.toolConfig = { functionCallingConfig: { mode: toGeminiToolMode(request.toolChoice) } };
    }
    body.generationConfig = {
      maxOutputTokens: request.maxTokens ?? this.maxTokens,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    };
    const modelSegment = this.model.startsWith('models/') ? this.model.replace(/^models\//, '') : this.model;
    const modelPath = `models/${modelSegment}`;
    const base = this.apiBase.replace(/\/$/, '');
    const url = `${base.endsWith('/models') ? `${base}/${modelSegment}` : `${base}/${modelPath}`}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: request.signal,
    });
    const json = await parseProviderResponse(response, 'Gemini');
    const candidate = Array.isArray(json.candidates) ? asJsonObject(json.candidates[0]) : {};
    const content = asJsonObject(candidate.content);
    const parts = Array.isArray(content.parts)
      ? content.parts.map((part) => asJsonObject(part))
      : [];
    let text = '';
    let reasoning = '';
    const toolCalls: LlmToolCall[] = [];
    for (const part of parts) {
      if (typeof part.text === 'string') text += part.text;
      if (typeof part.thought === 'string') reasoning += part.thought;
      if (part.functionCall && typeof part.functionCall === 'object') {
        const fn = asJsonObject(part.functionCall);
        if (typeof fn.name === 'string') {
          toolCalls.push({
            id: `gemini_${toolCalls.length + 1}`,
            name: fn.name,
            args: (fn.args || {}) as JsonObject,
          });
        }
      }
    }
    const usage = asJsonObject(json.usageMetadata);
    return {
      content: text,
      reasoning,
      toolCalls,
      usage: Object.keys(usage).length
        ? {
            inputTokens: Number(usage.promptTokenCount || 0),
            outputTokens: Number(usage.candidatesTokenCount || 0),
          }
        : undefined,
      finishReason: typeof candidate?.finishReason === 'string' ? candidate.finishReason : undefined,
    };
  }
}

function toAnthropicMessages(messages: ChatMessage[]): { system?: string; messages: Array<Record<string, unknown>> } {
  const system = messages.filter((message) => message.role === 'system').map((message) => chatText(message.content)).filter(Boolean).join('\n\n');
  const result: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'user') {
      result.push({ role: 'user', content: chatText(message.content) });
    } else if (message.role === 'assistant') {
      const content: Array<Record<string, unknown>> = [];
      if (message.reasoning_content) {
        content.push({ type: 'thinking', thinking: message.reasoning_content });
      }
      const text = chatText(message.content);
      if (text) content.push({ type: 'text', text });
      for (const call of message.tool_calls || []) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
      }
      result.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '' }] });
    } else if (message.role === 'tool') {
      result.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: message.tool_call_id || 'unknown', content: chatText(message.content) }],
      });
    }
  }
  return { system: system || undefined, messages: result };
}

function toGeminiContents(messages: ChatMessage[]): { systemInstruction?: string; contents: Array<Record<string, unknown>> } {
  const system = messages.filter((message) => message.role === 'system').map((message) => chatText(message.content)).filter(Boolean).join('\n\n');
  const contents: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    const parts: Array<Record<string, unknown>> = [];
    const text = chatText(message.content);
    if (text) parts.push({ text });
    if (message.role === 'assistant') {
      for (const call of message.tool_calls || []) {
        parts.push({ functionCall: { name: call.name, args: call.args } });
      }
      contents.push({ role: 'model', parts });
    } else if (message.role === 'tool') {
      const text = chatText(message.content);
      const parsed = parseJson(text || '{}');
      const response = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : { text: text || 'tool result' };
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: message.name || 'function', response } }],
      });
    } else {
      contents.push({ role: 'user', parts });
    }
  }
  return { systemInstruction: system || undefined, contents };
}

function toAnthropicToolChoice(value?: ToolChoice): unknown {
  if (value === 'none') return { type: 'none' };
  if (value === 'required') return { type: 'any' };
  return { type: 'auto' };
}

function toGeminiToolMode(value?: ToolChoice): string {
  if (value === 'none') return 'NONE';
  if (value === 'required') return 'ANY';
  return 'AUTO';
}

async function parseProviderResponse(response: Response, provider: string): Promise<Record<string, unknown>> {
  const body = await response.text();
  if (!response.ok) throw new Error(`${provider} API ${response.status}: ${body.slice(0, 500)}`);
  const parsed = parseJson(body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${provider} API 返回了无法解析的 JSON`);
  }
  return asJsonObject(parsed);
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /429|5\d\d|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network error/i.test(error.message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
