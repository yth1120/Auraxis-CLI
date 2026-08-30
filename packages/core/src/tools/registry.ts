import type { AgentEvent } from '../events.js';
import type { FilesClient, ImageDetail, McpHost, PlanTask, ToolDefinition, JsonObject } from '../types.js';
import {
  runFileTools,
  readFileTool,
  readImageFileTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  grepTool,
  globTool,
  resolveInside,
} from './files.js';
import { bashTool, pwshTool } from './shell.js';
import { runCodeTool, runWorkflowTool, runTaskTool } from '../code-tools.js';
import { runPtyAction, runTerminalAction, ptyRegistry } from '../terminal.js';
import { notebookEditTool } from './notebook.js';
import { webFetchTool, webSearchTool } from './web.js';
import { todoWriteTool } from './todo.js';
import { gitStatusTool, gitDiffTool, gitLogTool, gitCommitTool, gitCreatePullRequestTool } from './git.js';
import type { SkillRecord } from '../skills.js';
import { reviewArtifactTool } from './review.js';
import type { UndoStore } from '../undo.js';
import type { MemoryStore } from '../memory.js';
import type { SandboxPolicy } from '../sandbox.js';
import { scanPlugins, installPlugin, discoverMarketplace } from '../plugins.js';
import { findSymbols } from '../codeintel.js';
import type { LspManager } from '../lsp.js';
import type { SessionMailbox } from '../mailbox.js';
import { publishArtifact, listArtifacts } from '../artifacts.js';
import path from 'node:path';
import { asJsonObject } from '../validation.js';

export interface ToolContext {
  projectRoot: string;
  sessionId?: string;
  undo?: UndoStore;
  emit: (event: AgentEvent) => void;
  askUser?: (question: string) => Promise<string>;
  tools?: ToolDefinition[];
  todos: PlanTask[];
  setTodos: (todos: PlanTask[]) => void;
  signal?: AbortSignal;
  mcp?: McpHost;
  files?: FilesClient;
  supportsImages?: boolean;
  visionDetail?: ImageDetail;
  memory?: MemoryStore;
  mailbox?: SessionMailbox;
  lsp?: LspManager;
  sandbox?: SandboxPolicy;
  runSubAgent?: (prompt: string, description?: string) => Promise<string>;
  runSubAgents?: (tasks: Array<{ prompt: string; description?: string }>) => Promise<string[]>;
  listSkills?: () => Promise<SkillRecord[]>;
  readSkill?: (id: string) => Promise<string>;
  /** Code Mode / RunCode 子调用入口，由 Agent 运行时接完整权限与沙箱门禁。 */
  executeTool?: (name: string, input: JsonObject) => Promise<{ output: unknown; error?: string }>;
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
    name: 'RunCode',
    description:
      '执行模型编写的代码。language=javascript/python/shell 在隔离临时目录中运行；language=typescript 会在工作线程中执行工具编排程序，可通过 await tools.ToolName(args) 调用全部工具，并回穿权限管线。',
    danger: 'exec',
    parameters: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: ['javascript', 'python', 'shell', 'typescript'],
          description: '运行语言；typescript 为工具编排模式',
        },
        code: { type: 'string', description: '要执行的代码或 TypeScript 异步函数体' },
        description: { type: 'string', description: '简短说明程序做什么' },
        timeout_ms: { type: 'number', description: '超时毫秒数' },
      },
      required: ['language', 'code'],
    },
    required: ['language', 'code'],
  },
  {
    name: 'RunWorkflow',
    description:
      '运行内联编排脚本或预定义工作流。脚本是带顶层 await 的 JS，结尾 return 结果，可使用 ctx.projectRoot、ctx.log、ctx.sleep 和 ctx.agents.run。',
    danger: 'agent',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '预定义工作流名称' },
        script: { type: 'string', description: '内联编排脚本' },
        projectRoot: { type: 'string', description: '可选项目根目录' },
      },
      required: [],
    },
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
    name: 'Delete',
    description: '删除项目内文件或目录。删除文件前会保存撤销快照。',
    danger: 'write',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '要删除的文件或目录' },
        recursive: { type: 'boolean', description: '删除目录时必须为 true' },
      },
      required: ['file_path'],
    },
    required: ['file_path'],
  },
  {
    name: 'NotebookEdit',
    description: '读、写、插入或删除 Jupyter Notebook（.ipynb）单元格。',
    danger: 'write',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        action: { type: 'string', enum: ['read', 'write', 'insert', 'delete'] },
        cell_index: { type: 'number' },
        source: { type: 'string' },
        cell_type: { type: 'string', enum: ['code', 'markdown'] },
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
        name: { type: 'string', description: '后台任务显示名称' },
        run_in_background: { type: 'boolean', description: '后台运行并返回 task_id' },
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
    name: 'Replan',
    description: '根据当前进展重新生成实现计划。适合在任务卡住、需求变化或用户要求调整方案时使用。',
    danger: 'internal',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: '重新规划的原因' },
        context: { type: 'string', description: '当前状态补充说明' },
      },
      required: ['reason'],
    },
    required: ['reason'],
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
  {
    name: 'Agent',
    description: '启动一个子 Agent 自主处理复杂任务，并返回其最终结果。',
    danger: 'agent',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '子 Agent 的任务' },
        description: { type: 'string', description: '子 Agent 的简短说明' },
      },
      required: ['prompt'],
    },
    required: ['prompt'],
  },
  {
    name: 'SpawnAgents',
    description: '并行启动多个子 Agent，各自在隔离上下文中执行，并返回结果数组。',
    danger: 'agent',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['prompt'],
          },
          description: '最多 8 个任务，写操作会自动按顺序处理',
        },
      },
      required: ['tasks'],
    },
    required: ['tasks'],
  },
  {
    name: 'MemoryRemember',
    description: '把项目中的重要事实、约定或结论保存到长期记忆，供后续任务检索。',
    danger: 'internal',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '记忆标题' },
        content: { type: 'string', description: '要记住的内容' },
        tags: { type: 'array', items: { type: 'string' }, description: '可选标签' },
      },
      required: ['title', 'content'],
    },
    required: ['title', 'content'],
  },
  {
    name: 'MemorySearch',
    description: '搜索当前项目和全局长期记忆，返回最近相关记录。',
    danger: 'read',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        limit: { type: 'number', description: '最多返回条数，默认 10' },
      },
      required: ['query'],
    },
    required: ['query'],
  },
  {
    name: 'PluginManage',
    description: '列出、发现或安装 Auraxis 插件。插件可提供 skills、hooks 与 MCP 配置。',
    danger: 'internal',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'install', 'discover'], description: '操作类型' },
        source: { type: 'string', description: 'install 时为本地方案目录路径' },
      },
      required: ['action'],
    },
    required: ['action'],
  },
  {
    name: 'FindSymbol',
    description: '扫描项目源码并按名称查找函数、类、接口、类型、枚举或变量定义。',
    danger: 'read',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '符号名称关键词' },
        limit: { type: 'number', description: '最多返回条数，默认 20' },
      },
      required: ['symbol'],
    },
    required: ['symbol'],
  },
  {
    name: 'LspDefinition',
    description: '通过已配置的 LSP 服务器跳转到符号定义；未配置时自动回退到 FindSymbol。',
    danger: 'read',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        line: { type: 'number', description: '1-based 行号' },
        column: { type: 'number', description: '1-based 列号' },
      },
      required: ['file_path', 'line', 'column'],
    },
    required: ['file_path', 'line', 'column'],
  },
  {
    name: 'LspReferences',
    description: '通过已配置的 LSP 服务器查找符号引用；未配置时自动回退到 FindSymbol。',
    danger: 'read',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string' },
        line: { type: 'number' },
        column: { type: 'number' },
      },
      required: ['file_path', 'line', 'column'],
    },
    required: ['file_path', 'line', 'column'],
  },
  {
    name: 'RemoteAgent',
    description: '把任务委托给远程云 Agent 网关。适用于本地资源不足或需要云端专用计算的任务。',
    danger: 'network',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '任务描述' },
        description: { type: 'string', description: '可选说明' },
      },
      required: ['prompt'],
    },
    required: ['prompt'],
  },
  {
    name: 'SendMessage',
    description: '向另一个 Agent 会话发送消息，用于跨会话协作或提醒后续任务。',
    danger: 'internal',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '目标会话 ID' },
        message: { type: 'string', description: '消息内容' },
      },
      required: ['to', 'message'],
    },
    required: ['to', 'message'],
  },
  {
    name: 'ReadMessages',
    description: '读取发往当前会话的跨会话消息。',
    danger: 'read',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
  },
  {
    name: 'PublishArtifact',
    description: '把任务结果发布到项目 .auraxis/artifacts 目录，生成可复用的 Markdown 产物。',
    danger: 'write',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '产物标题' },
        content: { type: 'string', description: 'Markdown 内容' },
      },
      required: ['title', 'content'],
    },
    required: ['title', 'content'],
  },
  {
    name: 'ListArtifacts',
    description: '列出项目已有的产物。',
    danger: 'read',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'CreatePullRequest',
    description: '推送当前分支并创建 GitHub Pull Request。需要仓库已配置 origin 和 GITHUB_TOKEN/GH_TOKEN。',
    danger: 'network',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'PR 标题' },
        body: { type: 'string', description: 'PR 正文' },
        head: { type: 'string', description: '源分支，默认当前分支' },
        base: { type: 'string', description: '目标分支，默认 main' },
      },
      required: ['title'],
    },
    required: ['title'],
  },
  {
    name: 'GitStatus',
    description: '查看当前 Git 工作区状态。',
    danger: 'read',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'GitDiff',
    description: '查看当前未提交的文件变更统计。',
    danger: 'read',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'GitLog',
    description: '查看最近 20 条 Git 提交记录。',
    danger: 'read',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'GitCommit',
    description: '暂存所有改动并创建 Git 提交。',
    danger: 'write',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string', description: '提交信息' } },
      required: ['message'],
    },
    required: ['message'],
  },
  {
    name: 'ListSkills',
    description: '列出当前项目可用的本地技能。',
    danger: 'read',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'ReadSkill',
    description: '读取指定技能的完整 SKILL.md 内容。',
    danger: 'read',
    parameters: {
      type: 'object',
      properties: { skill_id: { type: 'string' } },
      required: ['skill_id'],
    },
    required: ['skill_id'],
  },
  {
    name: 'ReviewArtifact',
    description: '运行测试、类型检查或构建来验证当前修改。默认检测 package.json 中的 check/test/build 脚本。',
    danger: 'exec',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '可选，自定义验证命令' },
        timeout_ms: { type: 'number' },
      },
    },
  },
  {
    name: 'Undo',
    description: '撤销最近一次文件写入/编辑，恢复修改前的内容。没有历史记录时提示无可用撤销。',
    danger: 'write',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'TaskOutput',
    description: '读取后台命令、终端任务或子 Agent 的累积输出。',
    danger: 'read',
    parameters: {
      type: 'object',
      properties: { task_id: { type: 'string', description: '任务 ID' } },
      required: ['task_id'],
    },
    required: ['task_id'],
  },
  {
    name: 'TaskStop',
    description: '按 ID 停止运行中的后台任务。',
    danger: 'exec',
    parameters: {
      type: 'object',
      properties: { task_id: { type: 'string', description: '任务 ID' } },
      required: ['task_id'],
    },
    required: ['task_id'],
  },
  {
    name: 'TaskList',
    description: '列出后台 shell、终端任务与运行中的子任务。',
    danger: 'read',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'JobList',
    description: '列出所有后台任务，与 TaskList 等价。',
    danger: 'read',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'JobOutput',
    description: '读取后台任务输出，与 TaskOutput 等价。',
    danger: 'read',
    parameters: {
      type: 'object',
      properties: { job_id: { type: 'string', description: '任务 ID' } },
      required: ['job_id'],
    },
    required: ['job_id'],
  },
  {
    name: 'JobKill',
    description: '停止后台任务，与 TaskStop 等价。',
    danger: 'exec',
    parameters: {
      type: 'object',
      properties: { job_id: { type: 'string', description: '任务 ID' } },
      required: ['job_id'],
    },
    required: ['job_id'],
  },
  {
    name: 'Pty',
    description: '管理持久交互式 PTY 会话。动作：create / write / read / close / list / clear / signal。',
    danger: 'exec',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'write', 'read', 'close', 'list', 'clear', 'signal'] },
        session_id: { type: 'string' },
        command: { type: 'string' },
        cwd: { type: 'string' },
        data: { type: 'string' },
        enter: { type: 'boolean' },
        timeout_ms: { type: 'number' },
        signal: { type: 'string' },
      },
      required: ['action'],
    },
    required: ['action'],
  },
  {
    name: 'TerminalOpen',
    description: '打开当前任务的持久终端会话。',
    danger: 'exec',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
        session_id: { type: 'string' },
      },
    },
  },
  {
    name: 'TerminalList',
    description: '列出当前任务的终端会话。',
    danger: 'read',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'TerminalRead',
    description: '读取终端会话自上次读取以来的输出。',
    danger: 'read',
    parameters: {
      type: 'object',
      properties: { session_id: { type: 'string' }, timeout_ms: { type: 'number' } },
      required: ['session_id'],
    },
    required: ['session_id'],
  },
  {
    name: 'TerminalSend',
    description: '向终端会话发送输入，enter=true 时自动回车。',
    danger: 'exec',
    parameters: {
      type: 'object',
      properties: { session_id: { type: 'string' }, data: { type: 'string' }, enter: { type: 'boolean' } },
      required: ['session_id', 'data'],
    },
    required: ['session_id', 'data'],
  },
  {
    name: 'TerminalSignal',
    description: '向终端发送 SIGINT / SIGTSTP / SIGQUIT / SIGTERM / SIGKILL。',
    danger: 'exec',
    parameters: {
      type: 'object',
      properties: { session_id: { type: 'string' }, signal: { type: 'string' } },
      required: ['session_id', 'signal'],
    },
    required: ['session_id', 'signal'],
  },
  {
    name: 'TerminalClose',
    description: '关闭终端会话并释放进程。',
    danger: 'exec',
    parameters: {
      type: 'object',
      properties: { session_id: { type: 'string' } },
      required: ['session_id'],
    },
    required: ['session_id'],
  },
];

export const TOOL_RUNNERS = new Map<string, ToolRunner>([
  ['Read', readFileTool],
  ['ReadImage', readImageFileTool],
  ['RunCode', runCodeTool],
  ['RunWorkflow', runWorkflowTool],
  ['Write', writeFileTool],
  ['Edit', editFileTool],
  ['StrReplaceEditor', editFileTool],
  ['Delete', deleteFileTool],
  ['NotebookEdit', notebookEditTool],
  ['Grep', grepTool],
  ['Glob', globTool],
  ['ListFiles', (input, ctx) => runFileTools(input, ctx)],
  ['Bash', bashTool],
  ['Pwsh', pwshTool],
  ['WebFetch', webFetchTool],
  ['WebSearch', webSearchTool],
  ['TodoWrite', todoWriteTool],
  ['Replan', async (input) => ({
    content: JSON.stringify({
      ok: false,
      error: 'Replan 只能在 Agent 规划循环中调用，请通过主 Agent 触发重新规划。',
      reason: input.reason || '',
    }),
  })],
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
        tools: (ctx.tools || TOOL_DEFINITIONS).map((tool) => tool.name),
      },
      null,
    2,
    ),
  })],
  ['Agent', async (input, ctx) => {
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    if (!prompt) return { content: '缺少 prompt', artifact: null };
    if (!ctx.runSubAgent) return { content: '当前运行时不支持子 Agent', artifact: null };
    const description = typeof input.description === 'string' ? input.description : '子任务';
    try {
      const output = await ctx.runSubAgent(prompt, description);
      return { content: output, artifact: null };
    } catch (error) {
      return { content: `子 Agent 失败: ${error instanceof Error ? error.message : String(error)}`, artifact: null };
    }
  }],
  ['SpawnAgents', async (input, ctx) => {
    if (!Array.isArray(input.tasks)) return { content: 'tasks 必须是一个数组' };
    const tasks: Array<{ prompt: string; description?: string }> = [];
    for (const item of input.tasks) {
      const value = asJsonObject(item);
      if (typeof value.prompt !== 'string') continue;
      tasks.push({
        prompt: value.prompt,
        description: typeof value.description === 'string' ? value.description : undefined,
      });
      if (tasks.length >= 8) break;
    }
    if (!tasks.length) return { content: '缺少任务' };
    if (!ctx.runSubAgents) return { content: '当前运行时不支持并行子 Agent' };
    const outputs = await ctx.runSubAgents(tasks);
    return { content: outputs.map((output, index) => `[${index + 1}] ${output}`).join('\n\n') };
  }],
  ['MemoryRemember', async (input, ctx) => {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const content = typeof input.content === 'string' ? input.content.trim() : '';
    if (!title || !content) return { content: '需要 title 和 content' };
    const tags = Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === 'string') : [];
    if (!ctx.memory) return { content: '当前运行未启用长期记忆' };
    const record = await ctx.memory.remember(title, content, tags);
    return { content: `已保存记忆 ${record.id} · ${record.title}` };
  }],
  ['MemorySearch', async (input, ctx) => {
    const query = typeof input.query === 'string' ? input.query : '';
    const limit = typeof input.limit === 'number' ? Math.min(50, Math.max(1, Math.floor(input.limit))) : 10;
    if (!ctx.memory) return { content: '当前运行未启用长期记忆' };
    const records = await ctx.memory.search(query, limit);
    return {
      content: records.length
        ? records.map((record) => `- [${record.id}] ${record.title}\n  ${record.content.slice(0, 400)}${record.tags.length ? `\n  标签: ${record.tags.join(', ')}` : ''}`).join('\n')
        : '未找到相关记忆',
    };
  }],
  ['PluginManage', async (input, ctx) => {
    const action = typeof input.action === 'string' ? input.action : 'list';
    if (action === 'install') {
      const source = typeof input.source === 'string' ? input.source : '';
      if (!source) return { content: 'install 需要 source 参数' };
      const plugin = await installPlugin(source, ctx.projectRoot);
      return { content: `已安装插件 ${plugin.manifest.id} · ${plugin.manifest.name}` };
    }
    if (action === 'discover') {
      const marketplace = await discoverMarketplace();
      return {
        content: marketplace.length
          ? marketplace.map((plugin) => `- ${plugin.id} · ${plugin.name}${plugin.version ? ` v${plugin.version}` : ''}${plugin.description ? ` — ${plugin.description}` : ''}`).join('\n')
          : '未配置 AURAXIS_PLUGIN_MARKETPLACE',
      };
    }
    const plugins = await scanPlugins(ctx.projectRoot, process.env.AURAXIS_TRUST_PROJECT_HOOKS === '1');
    return {
      content: plugins.length
        ? plugins.map((plugin) => `- ${plugin.manifest.id} · ${plugin.manifest.name}${plugin.manifest.version ? ` v${plugin.manifest.version}` : ''}${plugin.manifest.skills?.length ? ` · skills: ${plugin.manifest.skills.join(', ')}` : ''}`).join('\n')
        : '暂无插件，可使用 PluginManage action=install source=<目录> 安装',
    };
  }],
  ['FindSymbol', async (input, ctx) => {
    const symbol = typeof input.symbol === 'string' ? input.symbol : '';
    if (!symbol) return { content: '需要 symbol 参数' };
    const limit = typeof input.limit === 'number' ? Math.min(100, Math.max(1, Math.floor(input.limit))) : 20;
    const found = await findSymbols(ctx.projectRoot, symbol, limit);
    return {
      content: found.length
        ? found.map((item) => `${item.name} · ${item.kind} · ${item.file}:${item.line}`).join('\n')
        : '未找到匹配符号',
    };
  }],
  ['LspDefinition', async (input, ctx) => {
    const file = resolveInside(ctx.projectRoot, input.file_path);
    const line = typeof input.line === 'number' ? Math.max(1, Math.floor(input.line)) : 1;
    const column = typeof input.column === 'number' ? Math.max(1, Math.floor(input.column)) : 1;
    if (!ctx.lsp) {
      const symbol = path.basename(file, path.extname(file));
      const fallback = await findSymbols(ctx.projectRoot, symbol, 5);
      return { content: fallback.length ? fallback.map((item) => `${item.name} · ${item.file}:${item.line}`).join('\n') : '未配置 LSP（AURAXIS_LSP_COMMAND）且未找到符号' };
    }
    const result = await ctx.lsp.definition(file, line, column);
    return { content: JSON.stringify(result, null, 2) };
  }],
  ['LspReferences', async (input, ctx) => {
    const file = resolveInside(ctx.projectRoot, input.file_path);
    const line = typeof input.line === 'number' ? Math.max(1, Math.floor(input.line)) : 1;
    const column = typeof input.column === 'number' ? Math.max(1, Math.floor(input.column)) : 1;
    if (!ctx.lsp) return { content: '未配置 LSP（AURAXIS_LSP_COMMAND），请先配置语言服务器' };
    const result = await ctx.lsp.references(file, line, column);
    return { content: JSON.stringify(result, null, 2) };
  }],
  ['RemoteAgent', async (input, ctx) => {
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    const description = typeof input.description === 'string' ? input.description : '远程任务';
    const endpoint = process.env.AURAXIS_REMOTE_API;
    if (!prompt) return { content: '缺少 prompt' };
    if (!endpoint) {
      return { content: '未配置 AURAXIS_REMOTE_API，无法委派远程 Agent' };
    }
    const token = process.env.AURAXIS_REMOTE_TOKEN || '';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ description, prompt, projectRoot: ctx.projectRoot }),
      signal: AbortSignal.timeout(120_000),
    });
    const json = asJsonObject(await response.json().catch(() => ({})));
    if (!response.ok) throw new Error(`远程 Agent ${response.status}: ${json.error || '请求失败'}`);
    return { content: typeof json.text === 'string' ? json.text : '远程 Agent 未返回内容' };
  }],
  ['SendMessage', async (input, ctx) => {
    const to = typeof input.to === 'string' ? input.to : '';
    const message = typeof input.message === 'string' ? input.message : '';
    if (!to || !message) return { content: '需要 to 和 message' };
    if (!ctx.mailbox) return { content: '当前运行未启用跨会话消息' };
    const sent = await ctx.mailbox.send(ctx.sessionId || 'anonymous', to, message);
    return { content: `已发送消息 ${sent.id} 到 ${to}` };
  }],
  ['ReadMessages', async (input, ctx) => {
    const limit = typeof input.limit === 'number' ? Math.min(100, Math.max(1, Math.floor(input.limit))) : 50;
    if (!ctx.mailbox) return { content: '当前运行未启用跨会话消息' };
    const messages = await ctx.mailbox.list(ctx.sessionId || '', limit);
    return {
      content: messages.length
        ? messages.map((message) => `[${message.from}] ${message.text}`).join('\n')
        : '暂无跨会话消息',
    };
  }],
  ['PublishArtifact', async (input, ctx) => {
    const title = typeof input.title === 'string' ? input.title : '';
    const content = typeof input.content === 'string' ? input.content : '';
    if (!title || !content) return { content: '需要 title 和 content' };
    const file = await publishArtifact(ctx.projectRoot, title, content);
    return { content: `已发布产物 ${file}` };
  }],
  ['ListArtifacts', async (_input, ctx) => {
    const artifacts = await listArtifacts(ctx.projectRoot);
    return { content: artifacts.length ? artifacts.map((artifact) => `- ${artifact}`).join('\n') : '暂无产物' };
  }],
  ['CreatePullRequest', gitCreatePullRequestTool],
  ['GitStatus', gitStatusTool],
  ['GitDiff', gitDiffTool],
  ['GitLog', gitLogTool],
  ['GitCommit', gitCommitTool],
  ['ListSkills', async (_, ctx) => {
    const skills = (await ctx.listSkills?.()) || [];
    return { content: skills.map((skill) => `${skill.id} · ${skill.name}\n${skill.description}`).join('\n') || '暂无技能' };
  }],
  ['ReadSkill', async (input, ctx) => {
    const id = typeof input.skill_id === 'string' ? input.skill_id : '';
    const content = id ? await ctx.readSkill?.(id) : undefined;
    return { content: content || `未找到技能 ${id}` };
  }],
  ['ReviewArtifact', reviewArtifactTool],
  ['Undo', async (_input, ctx) => {
    if (!ctx.undo) return { content: '撤销不可用：当前运行未启用快照' };
    const entry = await ctx.undo.revertLatest(ctx.sessionId || '');
    if (!entry) return { content: '没有可撤销的文件修改' };
    const relative = path.relative(ctx.projectRoot, entry.file);
    return { content: `已恢复 ${relative || entry.file}（${entry.content.length} 字符）` };
  }],
  ['TaskOutput', async (input, _ctx) => runTaskTool({ ...input, action: 'output' }, _ctx)],
  ['TaskStop', async (input, _ctx) => runTaskTool({ ...input, action: 'stop' }, _ctx)],
  ['TaskList', async (_input, _ctx) => runTaskTool({ action: 'list' }, _ctx)],
  ['JobList', async (_input, _ctx) => runTaskTool({ action: 'jobs' }, _ctx)],
  ['JobOutput', async (input, _ctx) => runTaskTool({ ...input, action: 'output' }, _ctx)],
  ['JobKill', async (input, _ctx) => runTaskTool({ ...input, action: 'stop' }, _ctx)],
  ['Pty', async (input, ctx) => {
    const result = await runPtyAction(
      typeof input.action === 'string' ? input.action : '',
      input,
      ctx.sessionId || 'terminal',
      ptyRegistry,
    );
    return { content: JSON.stringify(result) };
  }],
  ['TerminalOpen', async (input, ctx) => {
    const result = await runTerminalAction('open', input, ctx.sessionId || 'terminal', ptyRegistry);
    return { content: JSON.stringify(result) };
  }],
  ['TerminalList', async (_input, ctx) => {
    const result = await runTerminalAction('list', {}, ctx.sessionId || 'terminal', ptyRegistry);
    return { content: JSON.stringify(result) };
  }],
  ['TerminalRead', async (input, ctx) => {
    const result = await runTerminalAction('read', input, ctx.sessionId || 'terminal', ptyRegistry);
    return { content: JSON.stringify(result) };
  }],
  ['TerminalSend', async (input, ctx) => {
    const result = await runTerminalAction('send', input, ctx.sessionId || 'terminal', ptyRegistry);
    return { content: JSON.stringify(result) };
  }],
  ['TerminalSignal', async (input, ctx) => {
    const result = await runTerminalAction('signal', input, ctx.sessionId || 'terminal', ptyRegistry);
    return { content: JSON.stringify(result) };
  }],
  ['TerminalClose', async (input, ctx) => {
    const result = await runTerminalAction('close', input, ctx.sessionId || 'terminal', ptyRegistry);
    return { content: JSON.stringify(result) };
  }],
]);

export function getTools(): ToolDefinition[] {
  return TOOL_DEFINITIONS;
}

/** 只读、无共享状态的工具允许 Code Mode 并行子调用（复刻桌面端标记）。 */
const CONCURRENCY_SAFE_TOOLS = new Set([
  'Read',
  'ReadImage',
  'Grep',
  'Glob',
  'ListFiles',
  'GitStatus',
  'GitDiff',
  'GitLog',
  'ListSkills',
  'ReadSkill',
  'MemorySearch',
  'FindSymbol',
  'ReadMessages',
  'ListArtifacts',
  'InspectRuntime',
  'ReviewArtifact',
  'TaskOutput',
  'TaskList',
  'JobList',
  'JobOutput',
  'TerminalList',
  'TerminalRead',
]);

export function isToolConcurrencySafe(name: string): boolean {
  return CONCURRENCY_SAFE_TOOLS.has(name);
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
    case 'Delete':
    case 'NotebookEdit':
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
    case 'RunCode':
      return String(input.language || '');
    case 'RunWorkflow':
      return String(input.name || 'inline workflow');
    default: {
      const first = Object.values(input).find((value) => typeof value === 'string');
      return typeof first === 'string' ? first.slice(0, 100) : '';
    }
  }
}
