import { z } from 'zod';
import type { JsonObject } from './types.js';

export const modelProviderSchema = z.enum([
  'deepseek',
  'openai',
  'anthropic',
  'gemini',
  'ollama',
  'custom',
]);

export const approvalPolicySchema = z.enum(['ask', 'plan', 'auto']);
export const sandboxModeSchema = z.enum(['read', 'workspace-write', 'full', 'container']);
export const reasoningEffortSchema = z.enum(['low', 'high', 'max']);
export const toolChoiceSchema = z.enum(['auto', 'none', 'required']);
export const apiFamilySchema = z.enum(['chat', 'responses', 'anthropic']);
export const imageDetailSchema = z.enum(['low', 'high', 'original', 'auto']);

export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), z.unknown());
export const stringRecordSchema = z.record(z.string(), z.string());

export const customModelConfigSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    provider: modelProviderSchema.optional(),
    apiFamily: apiFamilySchema.optional(),
    apiBase: z.string().min(1).optional(),
    apiKeyEnv: z.string().min(1).optional(),
    headers: stringRecordSchema.optional(),
    contextWindow: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
    supportsImages: z.boolean().optional(),
    strictTools: z.boolean().optional(),
    experimental: z.boolean().optional(),
  })
  .passthrough();

export const customModelsSchema = z.array(customModelConfigSchema);

export const mcpServerConfigSchema = z
  .object({
    name: z.string().min(1),
    transport: z.enum(['stdio', 'http']).optional(),
    url: z.string().min(1).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: stringRecordSchema.optional(),
    headers: stringRecordSchema.optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (!value.url && !value.command) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'MCP 服务必须配置 url 或 command' });
    }
  });

export const mcpServersSchema = z.array(mcpServerConfigSchema);

export const hookConfigSchema = z
  .object({
    command: z.string().min(1),
    timeout: z.number().int().positive().optional(),
  })
  .passthrough();

export const hookProtocolSchema = z
  .object({
    decision: z.enum(['allow', 'block']).optional(),
    continue: z.boolean().optional(),
    stopReason: z.string().optional(),
    additionalContext: z.string().optional(),
  })
  .passthrough();

export const pluginManifestSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().optional(),
    description: z.string().optional(),
    skills: z.array(z.string()).optional(),
    hooks: z
      .record(
        z.string(),
        z.union([hookConfigSchema, z.array(hookConfigSchema)]),
      )
      .optional(),
    mcp: z.array(mcpServerConfigSchema).optional(),
  })
  .passthrough();

const hooksRecordSchema = z.record(
  z.string(),
  z.union([hookConfigSchema, z.array(hookConfigSchema)]),
);

export const hooksFileSchema = z
  .object({
    hooks: hooksRecordSchema.optional(),
  })
  .passthrough();

const textContentPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const imageContentPartSchema = z.object({
  type: z.literal('image_url'),
  image_url: z.object({ url: z.string(), detail: imageDetailSchema.optional() }),
});

const fileContentPartSchema = z.object({
  type: z.literal('file'),
  file_id: z.string().optional(),
  file_data: z.string().optional(),
  filename: z.string().optional(),
});

const chatContentSchema = z.union([
  z.string(),
  z.array(z.union([textContentPartSchema, imageContentPartSchema, fileContentPartSchema])),
]);

const llmToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: jsonObjectSchema,
});

export const chatMessageSchema = z.lazy(() =>
  z
    .object({
      role: z.enum(['system', 'user', 'assistant', 'tool']),
      content: chatContentSchema.optional(),
      tool_calls: z.array(llmToolCallSchema).optional(),
      tool_call_id: z.string().optional(),
      name: z.string().optional(),
      reasoning_content: z.string().optional(),
    })
    .passthrough(),
);

export const sessionRecordSchema = z
  .object({
    id: z.string().min(1),
    projectRoot: z.string().min(1),
    model: z.string().min(1),
    provider: modelProviderSchema.optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    messages: z.array(chatMessageSchema),
    summary: z.string().optional(),
  })
  .passthrough();

export const memoryRecordSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    content: z.string(),
    tags: z.array(z.string()),
    updatedAt: z.number(),
  })
  .passthrough();

export const auditRecordSchema = z
  .object({
    ts: z.number(),
    sessionId: z.string(),
    type: z.string(),
    data: z.unknown(),
  })
  .passthrough();

export const mailMessageSchema = z
  .object({
    id: z.string().min(1),
    from: z.string(),
    to: z.string(),
    text: z.string(),
    createdAt: z.number(),
  })
  .passthrough();

export const undoEntrySchema = z
  .object({
    file: z.string().min(1),
    content: z.string(),
    ts: z.number(),
  })
  .passthrough();

export const credentialFileSchema = z
  .object({
    version: z.literal(1),
    entries: z.record(
      z.string(),
      z.object({
        iv: z.string(),
        tag: z.string(),
        data: z.string(),
      }),
    ),
  })
  .passthrough();

const mcpToolSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    inputSchema: jsonObjectSchema.optional(),
  })
  .passthrough();

export const mcpToolsResultSchema = z
  .object({
    tools: z.array(mcpToolSchema).optional(),
  })
  .passthrough();

const mcpContentPartSchema = z
  .object({
    type: z.string().optional(),
    text: z.string().optional(),
  })
  .passthrough();

export const mcpCallResultSchema = z
  .object({
    content: z.array(mcpContentPartSchema).optional(),
    isError: z.boolean().optional(),
  })
  .passthrough();

export const rpcResponseSchema = z
  .object({
    jsonrpc: z.string().optional(),
    id: z.union([z.number(), z.string(), z.null()]).optional(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number().optional(),
        message: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

export const deepseekToolCallSchema = z
  .object({
    id: z.string().optional(),
    function: z
      .object({
        name: z.string().optional(),
        arguments: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const deepseekMessageSchema = z
  .object({
    content: z.string().nullable().optional(),
    reasoning_content: z.string().nullable().optional(),
    tool_calls: z.array(deepseekToolCallSchema).optional(),
  })
  .passthrough();

const deepseekChoiceSchema = z
  .object({
    message: deepseekMessageSchema.optional(),
    finish_reason: z.string().optional(),
  })
  .passthrough();

const deepseekDeltaSchema = z
  .object({
    content: z.string().nullable().optional(),
    reasoning_content: z.string().nullable().optional(),
    tool_calls: z
      .array(
        z
          .object({
            index: z.number().optional(),
            id: z.string().optional(),
            function: z
              .object({
                name: z.string().optional(),
                arguments: z.string().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const deepseekStreamChoiceSchema = z
  .object({
    delta: deepseekDeltaSchema.optional(),
    finish_reason: z.string().nullable().optional(),
  })
  .passthrough();

export const deepseekResponseSchema = z
  .object({
    choices: z.array(deepseekChoiceSchema).optional(),
    usage: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const deepseekStreamPageSchema = z
  .object({
    choices: z.array(deepseekStreamChoiceSchema).optional(),
    usage: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export function parseJsonWith<T>(raw: string, schema: z.ZodType<T>): T | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function parseJsonObject(raw: string): JsonObject | undefined {
  return parseJsonWith(raw, jsonObjectSchema);
}

export function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

export function parseJsonStringArray(raw: string): string[] | undefined {
  return parseJsonWith(raw, z.array(z.string()).max(10_000));
}
