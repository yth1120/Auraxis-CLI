import type { AgentEvent } from '../events.js';
import type { McpHost, PlanTask, ToolDefinition, JsonObject } from '../types.js';
import { runFileTools, readFileTool, readImageFileTool, writeFileTool, editFileTool, grepTool, globTool } from './files.js';
import { bashTool, pwshTool } from './shell.js';
import { webFetchTool, webSearchTool } from './web.js';
import { todoWriteTool } from './todo.js';

export interface ToolContext {
  projectRoot: string;
  emit: (event: AgentEvent) => void;
  askUser?: (question: string) => Promise<string>;
  todos: PlanTask[];
  setTodos: (todos: PlanTask[]) => void;
  signal?: AbortSignal;
  mcp?: McpHost;
}

export interface ToolOutput {
  content: string;
  artifact?: unknown;
}

export type ToolRunner = (input: JsonObject, ctx: ToolContext) => Promise<ToolOutput>;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'Read',
    description: '读取项目内文件内容。适合检查源码、配置、测试或文档。',
    danger: 'read',
    parameters: { type: 'object', properties: { file_path: { type: 'string', description: '项目相对路径或绝对路径' } }, required: ['file_path'] },
    required: ['file_path'],
  },
  {
    name: 'ReadImage',
    description: '读取 JPEG / PNG / GIF / WebP 图片并返回给视觉模型。',
    danger: 'read',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        prompt: { type: 'string', description: '希望模型看图后做什么' },
      },
      required: ['file_path'],
    },
    required: ['file_path'],
  },
  {
    name: 'Write',
    description: '创建或覆盖项目内文件。',
    danger: 'write',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '目标文件路径' },
        content: { type: 'string', description: '完整文件内容' },
      },
      required: ['file_path', 'content'],
    },
    required: ['file_path', 'content'],
  },
  {
    name: 'Edit',
    description: '在文件中精确替换 old_string 为 new_string。',
    danger: 'write',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  {
    name: 'StrReplaceEditor',
    description: '单一用途文本编辑器：查看、新建、替换、插入文件内容。',
    danger: 'write',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
      },
      required: ['file_path'],
    },
    required: ['file_path'],
  },
  {
    name: 'Grep',
    description: '用正则表达式搜索项目文件内容。',
    danger: 'read',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string', description: '可选，目录或文件路径' },
        max_matches: { type: 'number' },
      },
      required: ['pattern'],
    },
    required: ['pattern'],
  },
  {
    name: 'Glob',
    description: '按 glob 模式查找项目内文件。',
    danger: 'read',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '如 **/*.ts' },
        cwd: { type: 'string', description: '可选，相对项目根的目录' },
      },
      required: ['pattern'],
    },
    required: ['pattern'],
  },
  {
    name: 'ListFiles',
    description: '列出项目根目录或指定目录中的文件与目录。',
    danger: 'read',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: '可选目录路径' } },
    },
  },
  {
    name: 'Bash',
    description: '在项目目录执行 Shell 命令。默认 120 秒超时。',
    danger: 'exec',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
        timeout_ms: { type: 'number', description: '超时毫秒数，默认 120000' },
      },
      required: ['command'],
    },
    required: ['command'],
  },
  {
    name: 'Pwsh',
    description: '执行 PowerShell 命令（Windows 原生）。',
    danger: 'exec',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout_ms: { type: 'number' },
      },
      required: ['command'],
    },
    required: ['command'],
  },
  {
    name: 'WebFetch',
    description: '抓取 HTTP(S) URL 内容并提取纯文本。',
    danger: 'network',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        max_chars: { type: 'number' },
      },
      required: ['url'],
    },
    required: ['url'],
  },
  {
    name: 'WebSearch',
    description: '使用 DuckDuckGo 搜索网页，返回标题、URL 和摘要。',
    danger: 'network',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        max_results: { type: 'number' },
      },
      required: ['query'],
    },
    required: ['query'],
  },
  {
    name: 'TodoWrite',
    description: '创建或更新当前任务清单。',
    danger: 'internal',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              description: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'running', 'completed', 'blocked'] },
            },
            required: ['description', 'status'],
          },
        },
      },
      required: ['todos'],
    },
    required: ['todos'],
  },
  {
    name: 'AskUser',
    description: '向用户提出一个需要澄清的问题并等待回答。',
    danger: 'internal',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string' },
      },
      required: ['question'],
    },
    required: ['question'],
  },
  {
    name: 'InspectRuntime',
    description: '查看当前可用工具、模型和运行环境信息。',
    danger: 'read',
    parameters: { type: 'object', properties: {} },
  },
];

export const TOOL_RUNNERS = new Map<string, ToolRunner>([
  ['Read', readFileTool],
  ['ReadImage', readImageFileTool],
  ['Write', writeFileTool],
  ['Edit', editFileTool],
  ['StrReplaceEditor', editFileTool],
  ['Grep', grepTool],
  ['Glob', globTool],
  ['ListFiles', (input, ctx) => runFileTools(input, ctx)],
  ['Bash', bashTool],
  ['Pwsh', pwshTool],
  ['WebFetch', webFetchTool],
  ['WebSearch', webSearchTool],
  ['TodoWrite', todoWriteTool],
  ['AskUser', async (input, ctx) => {
    const question = typeof input.question === 'string' ? input.question : '';
    if (!question) return { content: '缺少 question' };
    const answer = await ctx.askUser?.(question);
    return { content: answer || '（用户未回答）' };
  }],
  ['InspectRuntime', async (_, ctx) => ({
    content: JSON.stringify(
      {
        platform: process.platform,
        projectRoot: ctx.projectRoot,
        tools: TOOL_DEFINITIONS.map((tool) => tool.name),
      },
      null,
      2,
    ),
  })],
]);

export function getTools(): ToolDefinition[] {
  return TOOL_DEFINITIONS;
}

export function getTool(name: string): { definition: ToolDefinition; runner: ToolRunner } | undefined {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.name === name);
  const runner = TOOL_RUNNERS.get(name);
  return definition && runner ? { definition, runner } : undefined;
}

export function isToolReadOnly(name: string): boolean {
  const tool = TOOL_DEFINITIONS.find((item) => item.name === name);
  return tool?.danger === 'read' || tool?.danger === 'internal';
}

export function summarizeToolInput(name: string, input: JsonObject): string {
  switch (name) {
    case 'Read':
    case 'ReadImage':
    case 'Write':
    case 'Edit':
    case 'StrReplaceEditor':
      return String(input.file_path || '');
    case 'Bash':
    case 'Pwsh':
      return String(input.command || '').replace(/\s+/g, ' ').slice(0, 100);
    case 'Grep':
      return String(input.pattern || '');
    case 'Glob':
      return String(input.pattern || '');
    case 'WebFetch':
    case 'WebSearch':
      return String(input.url || input.query || '');
    default: {
      const first = Object.values(input).find((value) => typeof value === 'string');
      return typeof first === 'string' ? first.slice(0, 100) : '';
    }
  }
}
