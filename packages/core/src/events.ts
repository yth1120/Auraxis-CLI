import type { PermissionRequest, Plan } from './types.js';

export type AgentEvent =
  | { type: 'text_chunk'; text: string }
  | { type: 'thinking_chunk'; chunk: string; isNewBlock?: boolean }
  | { type: 'iteration_start'; iteration: number }
  | { type: 'iteration_end'; iteration: number }
  | { type: 'tool_start'; toolName: string; input: Record<string, unknown> }
  | { type: 'tool_end'; toolName: string; durationMs: number; ok: boolean }
  | { type: 'tool_error'; toolName: string; error: string }
  | { type: 'plan_created'; plan: Plan }
  | { type: 'plan_updated'; plan: Plan }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheHitTokens?: number; cacheMissTokens?: number; reasoningTokens?: number }
  | { type: 'system_message'; level: 'info' | 'warning' | 'error'; content: string }
  | { type: 'error'; error: string }
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'done'; result?: string };

export function makeRequestId(prefix = 'req'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function truncateText(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, Math.max(1, max - 1))}…`;
}
