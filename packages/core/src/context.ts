import type { ChatMessage, LlmClient } from './types.js';
import { asJsonObject, parseJson } from './validation.js';

const DEFAULT_CONTEXT_BUDGET = 220_000;

/** 轻量 token 估算：中文约 1.2 char/token，英文约 4 char/token。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const ascii = text.replace(/[^\x00-\x7F]/g, '');
  const unicode = text.length - ascii.length;
  return Math.ceil(ascii.length / 4 + unicode * 0.8);
}

function messageSize(message: ChatMessage): number {
  const text =
    typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? message.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n')
        : '';
  return estimateTokens(text) + (message.reasoning_content ? estimateTokens(message.reasoning_content) : 0);
}

export function compactMessages(messages: ChatMessage[], budget = DEFAULT_CONTEXT_BUDGET): ChatMessage[] {
  const system = messages[0]?.role === 'system' ? messages[0] : undefined;
  const rest = system ? messages.slice(1) : messages;
  let used = system ? messageSize(system) : 0;
  const compacted: ChatMessage[] = system ? [system] : [];

  for (const message of rest) {
    const size = messageSize(message);
    if (used + size > budget && message.role === 'tool') {
      const summary = JSON.stringify({ ok: true, output: '[已压缩的历史工具输出]', truncated: true });
      const next = { ...message, content: summary };
      used += messageSize(next);
      compacted.push(next);
      continue;
    }
    if (message.role === 'tool' && size > 2_000) {
      const parsed = (() => {
        try {
          return asJsonObject(
            parseJson(typeof message.content === 'string' ? message.content : '{}'),
          );
        } catch {
          return { ok: true };
        }
      })();
      const output =
        typeof parsed.output === 'string'
          ? parsed.output
          : typeof parsed.error === 'string'
            ? parsed.error
            : typeof message.content === 'string'
              ? message.content
              : '';
      const summary = JSON.stringify({
        ok: parsed.ok !== false,
        error: typeof parsed.error === 'string' ? parsed.error : undefined,
        output: `${output.slice(0, 800)}\n…截断…\n${output.slice(-800)}`,
        truncated: true,
      });
      const next = { ...message, content: summary };
      used += messageSize(next);
      compacted.push(next);
      continue;
    }
    used += size;
    compacted.push(message);
  }
  return compacted;
}

export async function summarizeMessages(
  llm: LlmClient,
  messages: ChatMessage[],
  projectRoot: string,
  signal?: AbortSignal,
): Promise<{ summary: string; messages: ChatMessage[] }> {
  const system = messages[0]?.role === 'system' ? messages[0] : undefined;
  const latest = [...messages].reverse().find((message) => message.role === 'user');
  if (!latest) return { summary: '', messages };
  const prompt = [
    '请把下面的 Agent 对话压缩成一段中文摘要。保留：任务目标、已完成的修改、当前问题、下一步、以及任何用户明确要求。',
    '不要编造信息，不要输出 markdown，控制在 800 字以内。',
    '',
    messages
      .map((message) => `${message.role}: ${typeof message.content === 'string' ? message.content : '[内容]'}`)
      .join('\n')
      .slice(-60_000),
  ].join('\n');
  const result = await llm.chat({
    messages: [
      { role: 'system', content: system ? `你是上下文压缩器。项目根目录：${projectRoot}` : `你是上下文压缩器。项目根目录：${projectRoot}` },
      { role: 'user', content: prompt },
    ],
    tools: [],
    stream: false,
    maxTokens: 1_200,
    signal,
  });
  const summary = result.content.trim();
  return {
    summary,
    messages: [
      {
        role: 'system',
        content: `${system ? `${typeof system.content === 'string' ? system.content : ''}\n\n` : ''}## 历史摘要\n${summary}`,
      },
      { role: 'user', content: typeof latest.content === 'string' ? latest.content : '[用户消息]' },
    ],
  };
}

export function estimateChatTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + messageSize(message), 0);
}
