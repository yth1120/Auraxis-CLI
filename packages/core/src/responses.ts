import type {
  ChatContentPart,
  ChatMessage,
  JsonObject,
  LlmClient,
  LlmRequest,
  LlmResult,
  LlmToolCall,
  LlmUsage,
  ToolChoice,
} from './types.js';
import { asJsonObject, parseJson } from './validation.js';

interface ResponsiveInputItem {
  type: string;
  [key: string]: unknown;
}

export class ResponsesClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly apiBase: string,
    private readonly model: string,
    private readonly defaultMaxTokens = 32768,
    private readonly maxRetries = 3,
    private readonly headers?: Record<string, string>,
  ) {}

  async chat(request: LlmRequest): Promise<LlmResult> {
    if (!this.apiKey) throw new Error('未配置 API Key');
    const execute = () =>
      request.stream === false
        ? this.chatOnce(request)
        : this.chatStream(request);
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await execute();
      } catch (error) {
        if (request.signal?.aborted || attempt === this.maxRetries || !this.isRetryable(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
      }
    }
    throw new Error('Responses API 重试次数已耗尽');
  }

  private endpoints(): string {
    let base = this.apiBase.replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(base)) base = base.replace(/\/chat\/completions$/, '');
    if (/\/responses$/.test(base)) return base;
    return `${base}/responses`;
  }

  private body(request: LlmRequest, stream: boolean): Record<string, unknown> {
    const input = toResponsesInput(request.messages);
    const body: Record<string, unknown> = {
      model: this.model,
      input: input.items,
      max_output_tokens: request.maxTokens ?? this.defaultMaxTokens,
      stream,
    };
    if (input.instructions) body.instructions = input.instructions;
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
      body.tool_choice = toResponsesToolChoice(request.toolChoice);
    }
    body.reasoning = { effort: request.reasoningEffort || 'high' };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.responseFormat === 'json_object') {
      body.text = { format: { type: 'json_object' } };
    }
    return body;
  }

  private async chatOnce(request: LlmRequest): Promise<LlmResult> {
    const response = await fetch(this.endpoints(), {
      method: 'POST',
      headers: {
        ...this.headers,
        'content-type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(this.body(request, false)),
      signal: request.signal,
    });
    const json = await parseResponse(response);
    const result = parseResponseItems(json);
    request.onTextChunk?.(result.content);
    if (result.reasoning) request.onThinkingChunk?.(result.reasoning, true);
    if (result.usage) request.onUsage?.(result.usage);
    return result;
  }

  private async chatStream(request: LlmRequest): Promise<LlmResult> {
    const response = await fetch(this.endpoints(), {
      method: 'POST',
      headers: {
        ...this.headers,
        'content-type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(this.body(request, true)),
      signal: request.signal,
    });
    if (!response.body) throw new Error('Responses API 返回空流');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let eventName = '';
    let text = '';
    let reasoning = '';
    let usage: LlmUsage | undefined;
    const items = new Map<string, { id: string; name?: string; callId?: string; arguments: string }>();

    const consume = (line: string) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('event:')) {
        eventName = trimmed.slice(6).trim();
        return;
      }
      if (!trimmed.startsWith('data:')) return;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let data: unknown;
      try {
        data = JSON.parse(payload);
      } catch {
        return;
      }
      const event = asJsonObject(data);
      const type = typeof event.type === 'string' ? event.type : eventName;
      const item = asJsonObject(event.item || event.output_item);
      const itemId = typeof item.id === 'string' ? item.id : typeof event.item_id === 'string' ? String(event.item_id) : '';
      if (itemId && item.type === 'function_call') {
        items.set(itemId, {
          id: itemId,
          name: typeof item.name === 'string' ? item.name : undefined,
          callId: typeof item.call_id === 'string' ? item.call_id : itemId,
          arguments: typeof item.arguments === 'string' ? item.arguments : '',
        });
      }
      const delta = typeof event.delta === 'string' ? event.delta : '';
      if (type === 'response.output_text.delta' && delta) {
        text += delta;
        request.onTextChunk?.(delta);
      }
      if (type === 'response.reasoning_text.delta' && delta) {
        if (!reasoning) request.onThinkingChunk?.('', true);
        reasoning += delta;
        request.onThinkingChunk?.(delta, false);
      }
      if (type === 'response.function_call_arguments.delta' && delta && itemId) {
        const current = items.get(itemId) || { id: itemId, arguments: '' };
        current.arguments += delta;
        items.set(itemId, current);
      }
      if (type === 'response.completed' || type === 'response.incomplete' || type === 'response.failed') {
        const responseData = asJsonObject(event.response || event);
        if (responseData.usage) usage = mapResponsesUsage(responseData.usage);
      }
      if (event.usage) usage = mapResponsesUsage(event.usage);
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) consume(line);
    }
    if (buffer.trim()) consume(buffer);

    const toolCalls = [...items.values()]
      .filter((item) => item.name)
      .map((item) => ({
        id: item.callId || item.id,
        name: item.name as string,
        args: parseToolArguments(item.arguments),
      }));
    return {
      content: text,
      reasoning,
      toolCalls,
      usage,
      finishReason: undefined,
    };
  }

  private isRetryable(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return /429|5\d\d|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network error/i.test(error.message);
  }
}

function toResponsesInput(messages: ChatMessage[]): { instructions: string; items: ResponsiveInputItem[] } {
  const instructions = messages
    .filter((message) => message.role === 'system')
    .map((message) => chatText(message.content))
    .filter(Boolean)
    .join('\n\n');
  const items: ResponsiveInputItem[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'user') {
      items.push({ type: 'message', role: 'user', content: toResponsesContent(message.content) });
      continue;
    }
    if (message.role === 'assistant') {
      if (message.reasoning_content) {
        items.push({
          type: 'reasoning',
          content: [{ type: 'reasoning_text', text: message.reasoning_content }],
        });
      }
      const text = chatText(message.content);
      if (text) {
        items.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        });
      }
      for (const call of message.tool_calls || []) {
        items.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.args || {}),
        });
      }
      continue;
    }
    if (message.role === 'tool') {
      items.push({
        type: 'function_call_output',
        call_id: message.tool_call_id || 'unknown',
        output: typeof message.content === 'string' ? message.content : JSON.stringify(message.content || {}),
      });
    }
  }
  return { instructions, items };
}

function toResponsesContent(content?: string | ChatContentPart[]): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (part.type === 'text') return { type: 'input_text', text: part.text };
    if (part.type === 'image_url') {
      return {
        type: 'input_image',
        image_url: part.image_url.url,
        ...(part.image_url.detail ? { detail: part.image_url.detail } : {}),
      };
    }
    if (part.type === 'file' && part.file_id) return { type: 'input_image', file_id: part.file_id };
    if (part.type === 'file' && part.file_data) {
      return { type: 'input_image', image_url: part.file_data, ...(part.filename ? { name: part.filename } : {}) };
    }
    return { type: 'input_text', text: '' };
  });
}

function parseResponseItems(json: JsonObject): LlmResult {
  const output = Array.isArray(json.output) ? json.output.map((item) => asJsonObject(item)) : [];
  let content = '';
  let reasoning = '';
  const toolCalls: LlmToolCall[] = [];
  for (const item of output) {
    if (item.type === 'message') {
      const parts = Array.isArray(item.content) ? item.content.map((part) => asJsonObject(part)) : [];
      content += parts
        .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
        .map((part) => part.text as string)
        .join('');
    }
    if (item.type === 'reasoning') {
      const parts = Array.isArray(item.content) ? item.content.map((part) => asJsonObject(part)) : [];
      reasoning += parts
        .filter((part) => part.type === 'reasoning_text' && typeof part.text === 'string')
        .map((part) => part.text as string)
        .join('');
    }
    if (item.type === 'function_call' && typeof item.name === 'string') {
      toolCalls.push({
        id: typeof item.call_id === 'string' ? item.call_id : `call_${toolCalls.length + 1}`,
        name: item.name,
        args: parseToolArguments(typeof item.arguments === 'string' ? item.arguments : '{}'),
      });
    }
  }
  const events = asJsonObject(json);
  const usage = events.usage ? mapResponsesUsage(events.usage) : undefined;
  return {
    content,
    reasoning,
    toolCalls,
    usage,
    finishReason: typeof events.status === 'string' ? events.status : undefined,
  };
}

function parseToolArguments(raw: string): JsonObject {
  const parsed = parseJson(raw || '{}');
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? asJsonObject(parsed) : { raw };
}

function mapResponsesUsage(raw: unknown): LlmUsage {
  const usage = asJsonObject(raw);
  const inputDetails = asJsonObject(usage.input_tokens_details);
  const outputDetails = asJsonObject(usage.output_tokens_details);
  return {
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    reasoningTokens:
      typeof outputDetails.reasoning_tokens === 'number' ? outputDetails.reasoning_tokens : undefined,
    cacheHitTokens:
      typeof inputDetails.cached_tokens === 'number' ? inputDetails.cached_tokens : undefined,
  };
}

function chatText(content?: string | ChatContentPart[]): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function toResponsesToolChoice(value?: ToolChoice): unknown {
  if (value === 'none' || value === 'auto' || value === 'required' || value === undefined) return value || 'auto';
  if (value) return { type: 'function', name: value };
  return 'auto';
}

async function parseResponse(response: Response): Promise<JsonObject> {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Responses API ${response.status}: ${body.slice(0, 500)}`);
  }
  const parsed = parseJson(body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Responses API 返回了无法解析的 JSON');
  }
  return asJsonObject(parsed);
}
