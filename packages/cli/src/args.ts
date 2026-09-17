export interface CliOptions {
  help: boolean;
  version: boolean;
  run?: string;
  code?: string;
  complete?: string;
  fim?: string;
  files?: string;
  filesArgs?: string[];
  project?: string;
  model?: string;
  provider?: string;
  apiFamily?: string;
  apiKey?: string;
  setApiKey?: string;
  apiBase?: string;
  mode?: string;
  sandbox?: string;
  visionDetail?: string;
  strictTools?: boolean;
  theme?: string;
  reasoningEffort?: string;
  maxTokens?: number;
  maxSteps?: number;
  contextBudget?: number;
  toolChoice?: string;
  json: boolean;
  autoApprove: boolean;
  approvePlan: boolean;
  session?: string;
  sessions: boolean;
  doctor: boolean;
  appServer: boolean;
  noBanner: boolean;
  noColor: boolean;
}

function valueOf(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index >= 0 && argv[index + 1] !== undefined) return argv[index + 1];
  const eq = argv.find((arg) => arg.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}

function has(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

export function apiKeyEnvName(provider?: string): string {
  switch ((provider || 'deepseek').toLowerCase()) {
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'gemini':
      return 'GEMINI_API_KEY';
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'ollama':
      return 'OLLAMA_API_KEY';
    default:
      return 'DEEPSEEK_API_KEY';
  }
}

export function parseStepLimit(value?: string): number | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['unlimited', 'inf', 'infinite', '∞'].includes(normalized)) return -1;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed <= 0 ? -1 : Math.max(1, Math.floor(parsed));
}

export function parseArgs(argv: string[]): CliOptions {
  const mode = valueOf(argv, '--mode') || valueOf(argv, '--permission-mode');
  const filesIndex = argv.indexOf('--files');
  const reasoningEffort = valueOf(argv, '--reasoning-effort');
  const maxSteps = parseStepLimit(valueOf(argv, '--max-steps') ?? valueOf(argv, '--max-iterations'));
  const rawMaxTokens = valueOf(argv, '--max-tokens');
  const maxTokens = rawMaxTokens ? Math.max(1, Math.floor(Number(rawMaxTokens))) : undefined;
  const rawContextBudget = valueOf(argv, '--context-budget');
  const contextBudget = rawContextBudget ? Math.max(1000, Math.floor(Number(rawContextBudget))) : undefined;
  return {
    help: has(argv, '--help') || has(argv, '-h'),
    version: has(argv, '--version') || has(argv, '-v'),
    run: valueOf(argv, '--run'),
    code: valueOf(argv, '--code-file') || valueOf(argv, '--code'),
    complete: valueOf(argv, '--complete'),
    fim: valueOf(argv, '--fim'),
    files: valueOf(argv, '--files'),
    filesArgs: filesIndex >= 0 ? argv.slice(filesIndex + 1) : undefined,
    project: valueOf(argv, '--project') || valueOf(argv, '--cwd'),
    model: valueOf(argv, '--model'),
    provider: valueOf(argv, '--provider'),
    apiFamily: valueOf(argv, '--api-family'),
    apiKey: valueOf(argv, '--api-key'),
    setApiKey: valueOf(argv, '--set-api-key'),
    apiBase: valueOf(argv, '--api-base'),
    mode,
    sandbox: valueOf(argv, '--sandbox'),
    visionDetail: valueOf(argv, '--vision-detail'),
    strictTools: has(argv, '--strict-tools')
      ? true
      : has(argv, '--no-strict-tools')
        ? false
        : undefined,
    theme: valueOf(argv, '--theme'),
    reasoningEffort,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : undefined,
    maxSteps,
    contextBudget: Number.isFinite(contextBudget) ? contextBudget : undefined,
    toolChoice: valueOf(argv, '--tool-choice'),
    json: has(argv, '--json'),
    autoApprove: has(argv, '--auto-approve') || has(argv, '--auto'),
    approvePlan: has(argv, '--approve-plan'),
    session: valueOf(argv, '--session') || valueOf(argv, '--resume') || valueOf(argv, '--continue'),
    sessions: has(argv, '--sessions'),
    doctor: has(argv, '--doctor'),
    appServer: has(argv, '--app-server'),
    noBanner: has(argv, '--no-banner') || has(argv, '--no-home'),
    noColor: has(argv, '--no-color') || has(argv, '--no-colour'),
  };
}

export function usage(): string {
  return [
    'Auraxis CLI — 纯 Node Agent 工作台',
    '',
    '用法:',
    '  auraxis                             交互式 TUI',
    '  auraxis --run "<任务>" [选项]        非交互执行',
    '  auraxis --sessions                  查看历史会话',
    '  auraxis --code-file <file.ts>      以 Code Mode 运行程序',
    '  auraxis --complete "<前缀>"          使用 Chat Prefix Completion 补全',
    '  auraxis --fim "<前缀>||<后缀>"        使用 FIM Completion 补全中间内容',
    '  auraxis --files <list|upload <path>|info <id>|delete <id>>  管理 Files API',
    '  auraxis --doctor                    检查环境',
    '  auraxis --app-server                启动 JSON-RPC App Server',
    '',
    '选项:',
    '  --project <dir>           项目目录',
    '  --cwd <dir>               --project 别名',
    '  --model <id>              模型 ID',
    '  --provider <provider>     模型供应商（deepseek|openai|anthropic|gemini|ollama|custom）',
    '  --api-family <chat|responses|anthropic>   DeepSeek 接口协议',
    '  --api-key <key>           模型供应商 API Key',
    '  --set-api-key <key>       加密保存当前供应商 API Key',
    '  --api-base <url>          API 地址',
    '  --mode <ask|plan|auto>    审批策略',
    '  --permission-mode <mode>  --mode 别名',
    '  --sandbox <read|workspace-write|full|container>  沙箱策略',
    '  --vision-detail <low|high|original|auto> 图片处理精度',
    '  --strict-tools            启用 strict Function Calling',
    '  --no-strict-tools         禁用 strict Function Calling',
    '  --theme <dark|light|neon|mono>  主题',
    '  --reasoning-effort <low|high|max>',
    '  --tool-choice <auto|none|required>',
    '  --max-tokens <n>',
    '  --max-steps <n>           单次任务的工具轮次上限；0/-1 表示不设上限',
    '  --max-iterations <n>      --max-steps 的兼容别名（已弃用）',
    '  --context-budget <n> 上下文 token 预算，超出后自动摘要',
    '  --session <id>            恢复会话',
    '  --resume / --continue <id>  --session 别名',
    '  --auto-approve            自动批准工具调用',
    '  --auto                    --auto-approve 别名',
    '  --approve-plan            自动批准计划',
    '  --json                    输出 NDJSON',
    '  --no-banner               跳过启动卡片',
    '  --no-home                 --no-banner 别名',
    '  --no-color                禁用彩色输出',
    '  --help / --version',
  ].join('\n');
}
