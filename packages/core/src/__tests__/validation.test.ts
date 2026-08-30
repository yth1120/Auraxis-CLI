import { describe, expect, it } from 'vitest';
import {
  asJsonObject,
  chatMessageSchema,
  customModelConfigSchema,
  deepseekResponseSchema,
  deepseekStreamPageSchema,
  hookConfigSchema,
  hooksFileSchema,
  mcpServerConfigSchema,
  parseJson,
  parseJsonObject,
  parseJsonStringArray,
  parseJsonWith,
  rpcResponseSchema,
  sessionRecordSchema,
} from '../validation.js';

describe('validation helpers', () => {
  it('parses JSON without throwing on malformed input', () => {
    expect(parseJson('{"ok":true}')).toEqual({ ok: true });
    expect(parseJson('{bad')).toBeUndefined();
    expect(parseJsonObject('[1,2]')).toBeUndefined();
    expect(parseJsonStringArray('["a","b"]')).toEqual(['a', 'b']);
    expect(parseJsonWith('{"n":1}', customModelConfigSchema)).toBeUndefined();
  });

  it('normalizes arbitrary input to a JSON object', () => {
    expect(asJsonObject(null)).toEqual({});
    expect(asJsonObject([])).toEqual({});
    expect(asJsonObject({ a: 1 })).toEqual({ a: 1 });
  });

  it('validates custom model configs and hook configs', () => {
    expect(customModelConfigSchema.safeParse({ id: 'm', name: 'M' }).success).toBe(true);
    expect(customModelConfigSchema.safeParse({ id: '', name: 'M' }).success).toBe(false);
    expect(hookConfigSchema.safeParse({ command: 'echo hi' }).success).toBe(true);
    expect(hookConfigSchema.safeParse({ command: 'echo hi', timeout: -1 }).success).toBe(false);
  });

  it('validates MCP, hook file, session and RPC payloads', () => {
    expect(mcpServerConfigSchema.safeParse({ name: 'demo', command: 'node' }).success).toBe(true);
    expect(mcpServerConfigSchema.safeParse({ name: 'demo', url: 'https://example.test' }).success).toBe(true);
    expect(mcpServerConfigSchema.safeParse({ name: 'demo' }).success).toBe(false);
    expect(hooksFileSchema.safeParse({ hooks: { stop: { command: 'echo done' } } }).success).toBe(true);
    expect(
      sessionRecordSchema.safeParse({
        id: 's1',
        projectRoot: '/tmp/x',
        model: 'deepseek-v4-pro',
        createdAt: 1,
        updatedAt: 2,
        messages: [{ role: 'user', content: 'hi' }],
      }).success,
    ).toBe(true);
    expect(rpcResponseSchema.safeParse({ jsonrpc: '2.0', id: 1, result: {} }).success).toBe(true);
  });

  it('validates chat messages and deepseek responses', () => {
    expect(chatMessageSchema.safeParse({ role: 'assistant', content: 'ok', tool_calls: [{ id: 't', name: 'Read', args: { file_path: 'a.ts' } }] }).success).toBe(true);
    expect(chatMessageSchema.safeParse({ role: 'bad', content: 'ok' }).success).toBe(false);
    expect(
      deepseekResponseSchema.safeParse({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      }).success,
    ).toBe(true);
  });

  it('accepts null fields in DeepSeek streaming chunks', () => {
    expect(
      deepseekStreamPageSchema.safeParse({
        choices: [{
          delta: { content: null, reasoning_content: null },
          finish_reason: null,
        }],
      }).success,
    ).toBe(true);
  });
});
