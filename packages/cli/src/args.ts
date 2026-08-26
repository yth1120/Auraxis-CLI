export interface CliOptions {
  help: boolean;
  version: boolean;
  run?: string;
  project?: string;
  model?: string;
  apiKey?: string;
  setApiKey?: string;
  apiBase?: string;
  mode?: string;
  sandbox?: string;
  deepThink?: boolean;
  reasoningEffort?: string;
  maxIterations?: number;
  toolChoice?: string;
  json: boolean;
  autoApprove: boolean;
  approvePlan: boolean;
  session?: string;
  sessions: boolean;
  doctor: boolean;
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

export function parseArgs(argv: string[]): CliOptions {
  const mode = valueOf(argv, '--mode') || valueOf(argv, '--permission-mode');
  const reasoningEffort = valueOf(argv, '--reasoning-effort');
  const rawMax = valueOf(argv, '--max-iterations');
  const maxIterations = rawMax ? Math.max(1, Math.floor(Number(rawMax))) : undefined;
  return {
    help: has(argv, '--help') || has(argv, '-h'),
    version: has(argv, '--version') || has(argv, '-v'),
    run: valueOf(argv, '--run'),
    project: valueOf(argv, '--project') || valueOf(argv, '--cwd'),
    model: valueOf(argv, '--model'),
    apiKey: valueOf(argv, '--api-key'),
    setApiKey: valueOf(argv, '--set-api-key'),
    apiBase: valueOf(argv, '--api-base'),
    mode,
    sandbox: valueOf(argv, '--sandbox'),
    deepThink: has(argv, '--deep-think') || has(argv, '--deepthink'),
    reasoningEffort,
    maxIterations: Number.isFinite(maxIterations) ? maxIterations : undefined,
    toolChoice: valueOf(argv, '--tool-choice'),
    json: has(argv, '--json'),
    autoApprove: has(argv, '--auto-approve') || has(argv, '--auto'),
    approvePlan: has(argv, '--approve-plan'),
    session: valueOf(argv, '--session') || valueOf(argv, '--resume') || valueOf(argv, '--continue'),
    sessions: has(argv, '--sessions') || has(argv, 'session'),
    doctor: has(argv, '--doctor') || has(argv, 'doctor'),
    noColor: has(argv, '--no-color') || has(argv, '--no-color'),
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
    '  auraxis --doctor                    检查环境',
    '',
    '选项:',
    '  --project <dir>           项目目录',
    '  --model <id>              模型 ID',
    '  --api-key <key>           DeepSeek API Key',
    '  --set-api-key <key>       加密保存 DeepSeek API Key',
    '  --api-base <url>          API 地址',
    '  --mode <ask|plan|auto>    审批策略',
    '  --sandbox <read|workspace-write|full>  沙箱策略',
    '  --deep-think              启用深度思考',
    '  --reasoning-effort <low|high|max>',
    '  --max-iterations <n>',
    '  --session <id>            恢复会话',
    '  --auto-approve            自动批准工具调用',
    '  --approve-plan            自动批准计划',
    '  --json                    输出 NDJSON',
    '  --help / --version',
  ].join('\n');
}
