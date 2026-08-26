import type {
  ChatMessage,
  LlmClient,
  LlmRequest,
  LlmResult,
  LlmToolCall,
  LlmUsage,
  ToolChoice,
} from './types.js';

export class DeepSeekClient implements LlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly apiBase: string,
    private readonly model: string,
    private readonly defaultMaxTokens = 32768,
  ) {}

  async chat(request: LlmRequest): Promise<LlmResult> {
    if (!this.apiKey) throw new Error('未配置 DeepSeek API Key');
    if (request.stream === false) {
      return this.chatOnce(request);
    }
    return this.chatStream(request);
  }

  private buildBody(request: LlmRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages,
      max_tokens: request.maxTokens ?? this.defaultMaxTokens,
      stream,
    };
    if (stream) {
      body.stream_options = { include_usage: true };
    }
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      body.tool_choice = this.normalizeToolChoice(request.toolChoice);
    }
    if (request.isDeepThink) {
      body.thinking = { type: 'enabled' };
      body.reasoning_effort = request.reasoningEffort || 'high';
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
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(this.buildBody(request, false)),
      signal: request.signal,
    });
    const json = await parseResponse(response);
    const choices = json.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    const message = (choice?.message || {}) as Record<string, unknown>;
    const usage = json.usage;
    const result: LlmResult = {
      content: typeof message.content === 'string' ? message.content : '',
      reasoning: typeof message.reasoning_content === 'string' ? message.reasoning_content : '',
      toolCalls: parseMessageToolCalls(message.tool_calls),
      usage: usage ? mapUsage(usage) : undefined,
      finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
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
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (parsed.usage) {
          usage = mapUsage(parsed.usage);
          request.onUsage?.(usage);
        }
        const choice = (parsed.choices as Array<Record<string, unknown>> | undefined)?.[0];
        if (!choice) continue;
        const delta = (choice.delta || {}) as Record<string, unknown>;
        if (choice.finish_reason) {
          finishReason = choice.finish_reason as string;
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
            const call = raw as Record<string, unknown>;
            const index = Number(call.index ?? 0);
            const current = inFlight.get(index) || { id: `call_${index}_${Date.now()}`, name: '', args: '' };
            if (typeof call.id === 'string' && call.id) current.id = call.id;
            const fn = (call.function || {}) as Record<string, unknown>;
            if (typeof fn.name === 'string' && fn.name) current.name = fn.name;
            if (typeof fn.arguments === 'string') current.args += fn.arguments;
            inFlight.set(index, current);
          }
        }
      }
    }

    const toolCalls = [...inFlight.values()]
      .filter((call) => call.name)
      .map((call) => {
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(call.args || '{}') as Record<string, unknown>;
          args = parsed;
        } catch {
          args = { raw: call.args };
        }
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

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek API ${response.status}: ${body.slice(0, 500)}`);
  }
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error('DeepSeek API 返回了无法解析的 JSON');
  }
}

function parseMessageToolCalls(raw: unknown): LlmToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const call = item as Record<string, unknown>;
      const fn = (call.function || {}) as Record<string, unknown>;
      const name = typeof fn.name === 'string' ? fn.name : '';
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(typeof fn.arguments === 'string' ? fn.arguments : '{}') as Record<string, unknown>;
      } catch {
        args = { raw: fn.arguments };
      }
      return {
        id: typeof call.id === 'string' ? call.id : `call_${Math.random().toString(36).slice(2, 10)}`,
        name,
        args,
      };
    })
    .filter((call) => call.name);
}

function mapUsage(raw: unknown): LlmUsage {
  const usage = raw as Record<string, unknown>;
  const details = (usage.completion_tokens_details || {}) as Record<string, unknown>;
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

export function mergeVisionMessages(messages: ChatMessage[], model: string): ChatMessage[] {
  // Pure Node CLI keeps image handling minimal for the first release. If a
  // vision model is selected and an image path is provided in the prompt, the
  // runtime can be extended later without changing the engine contract.
  return messages;
}
