export interface CommandHint {
  command: string;
  usage: string;
  description: string;
  group: '执行' | '模型' | '集成' | '会话' | '管理';
  aliases?: readonly string[];
}

export const COMMAND_HINTS: readonly CommandHint[] = [
  { command: '/model', usage: '/model', description: '选择模型', group: '模型', aliases: ['m'] },
  { command: '/permission', usage: '/permission', description: '选择审批模式', group: '模型', aliases: ['mode', 'permissions', 'p'] },
  { command: '/reasoning', usage: '/reasoning', description: '选择思考强度', group: '模型', aliases: ['effort', 'think', 'e'] },
  { command: '/sandbox', usage: '/sandbox', description: '选择沙箱策略', group: '模型', aliases: ['s'] },
  { command: '/provider', usage: '/provider', description: '选择供应商', group: '模型', aliases: ['prov'] },
  { command: '/api-family', usage: '/api-family', description: '切换 Chat / Responses / Anthropic 协议', group: '模型', aliases: ['family'] },
  { command: '/vision-detail', usage: '/vision-detail', description: '设置图片处理精度', group: '模型', aliases: ['image-detail'] },
  { command: '/strict-tools', usage: '/strict-tools', description: '开启或关闭 strict Function Calling', group: '模型', aliases: ['strict'] },
  { command: '/tool-choice', usage: '/tool-choice', description: '设置工具调用策略', group: '模型', aliases: ['tool'] },
  { command: '/api-base', usage: '/api-base', description: '设置 API 地址', group: '模型', aliases: ['endpoint'] },
  { command: '/api-key', usage: '/api-key', description: '保存 API Key', group: '模型', aliases: ['key'] },
  { command: '/max-tokens', usage: '/max-tokens', description: '设置最大输出 token', group: '模型', aliases: ['tokens'] },
  { command: '/context-budget', usage: '/context-budget', description: '设置上下文预算', group: '模型', aliases: ['context'] },
  { command: '/theme', usage: '/theme', description: '切换终端主题', group: '模型', aliases: ['colour'] },
  { command: '/mcp', usage: '/mcp', description: '管理 MCP 服务', group: '集成', aliases: ['mcp-tools'] },
  { command: '/skills', usage: '/skills', description: '打开技能卡片面板', group: '集成', aliases: ['skill'] },
  { command: '/plugins', usage: '/plugins', description: '查看或管理插件', group: '集成', aliases: ['plugin'] },
  { command: '/memory', usage: '/memory', description: '查看或写入长期记忆', group: '集成', aliases: ['mem'] },
  { command: '/files', usage: '/files', description: '管理 DeepSeek Files API', group: '集成', aliases: ['remote-files'] },
  { command: '/symbol', usage: '/symbol', description: '查找符号', group: '集成', aliases: ['find-symbol'] },
  { command: '/agents', usage: '/agents', description: '打开多 Agent 任务输入', group: '执行', aliases: ['agent', 'a'] },
  { command: '/review', usage: '/review', description: '检查测试、类型检查与构建结果', group: '执行', aliases: ['r'] },
  { command: '/git', usage: '/git', description: '检查当前仓库状态', group: '执行', aliases: ['g'] },
  { command: '/run', usage: '/run <file>', description: '运行文件', group: '执行', aliases: ['run-file', 'x'] },
  { command: '/code', usage: '/code <file>', description: '运行 Code Mode 程序', group: '执行', aliases: ['c'] },
  { command: '/worktree', usage: '/worktree', description: '创建或管理工作树', group: '执行', aliases: ['wt'] },
  { command: '/checkpoint', usage: '/checkpoint', description: '创建或恢复检查点', group: '执行', aliases: ['cp'] },
  { command: '/complete', usage: '/complete <前缀>', description: 'Chat Prefix Completion', group: '执行', aliases: ['prefix'] },
  { command: '/fim', usage: '/fim <前缀||后缀>', description: 'FIM 补全', group: '执行', aliases: ['fill', 'middle'] },
  { command: '/init', usage: '/init', description: '初始化项目配置', group: '执行', aliases: ['init-project'] },
  { command: '/session', usage: '/session', description: '创建、切换或查看会话', group: '会话', aliases: ['resume'] },
  { command: '/sessions', usage: '/sessions', description: '列出历史会话', group: '会话', aliases: ['conversations'] },
  { command: '/delete', usage: '/delete', description: '删除历史会话', group: '会话', aliases: ['remove-session'] },
  { command: '/clear', usage: '/clear', description: '清空当前对话', group: '会话', aliases: ['new'] },
  { command: '/status', usage: '/status', description: '查看当前运行状态', group: '管理', aliases: ['st'] },
  { command: '/tools', usage: '/tools', description: '列出当前工具', group: '管理', aliases: ['tool-list'] },
  { command: '/history', usage: '/history', description: '查看命令历史', group: '管理', aliases: ['hist'] },
  { command: '/doctor', usage: '/doctor', description: '检查模型、沙箱、工具与 MCP', group: '管理', aliases: ['check'] },
  { command: '/audit', usage: '/audit', description: '查看会话审计记录', group: '管理', aliases: ['logs'] },
  { command: '/config', usage: '/config', description: '查看或持久化配置', group: '管理', aliases: ['settings'] },
  { command: '/home', usage: '/home', description: '返回启动主页', group: '管理', aliases: ['dashboard'] },
  { command: '/help', usage: '/help', description: '打开命令帮助面板', group: '管理', aliases: ['h', '?'] },
  { command: '/quit', usage: '/quit', description: '退出', group: '管理', aliases: ['exit', 'q'] },
];

export const COMMAND_ALIASES: Readonly<Record<string, string>> = Object.fromEntries(
  COMMAND_HINTS.flatMap((hint) => [
    [hint.command.slice(1), hint.command.slice(1)],
    ...(hint.aliases || []).map((alias) => [alias, hint.command.slice(1)]),
  ]),
);

export function resolveCommandAlias(value: string): string {
  const normalized = value.trim().toLowerCase();
  return COMMAND_ALIASES[normalized] || value;
}

export function resolveSuggestedCommand(
  input: string,
  suggestions: readonly CommandHint[],
  selected: number,
): string {
  const hint = suggestions[Math.min(Math.max(0, selected), Math.max(0, suggestions.length - 1))];
  return hint?.command || input;
}

export function normalizeCommandToken(value: string): string {
  return value.toLowerCase().replace(/[:\-_\s]+/g, '');
}

function commandNameTokens(name: string): string[] {
  return name
    .split(/[-_:]+/)
    .flatMap((segment) => segment.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) || [segment])
    .map(normalizeCommandToken);
}

export function matchCommandHints(input: string): CommandHint[] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/') || /\s/.test(trimmed)) return [];
  const query = trimmed.slice(1);
  const normalizedQuery = normalizeCommandToken(query);
  if (!normalizedQuery) return COMMAND_HINTS.filter((hint) => hint.group === '模型').slice(0, 8);
  return COMMAND_HINTS.filter((hint) => {
    const names = [hint.command.slice(1), ...(hint.aliases || [])];
    return names.some((name) => {
      const normalizedName = normalizeCommandToken(name);
      const tokens = commandNameTokens(name);
      return normalizedName.startsWith(normalizedQuery) || tokens.some((token) => token.startsWith(normalizedQuery));
    });
  }).slice(0, 8);
}

export function isExactCommandHint(input: string, hint: CommandHint): boolean {
  const normalizedInput = normalizeCommandToken(input.trimStart().slice(1));
  const names = [hint.command.slice(1), ...(hint.aliases || [])];
  return names.some((name) => normalizeCommandToken(name) === normalizedInput);
}

export function commandHintLabel(hint: CommandHint): string {
  const alias =
    hint.aliases && hint.aliases.length
      ? ` · /${hint.aliases.slice(0, 2).join(' /')}`
      : '';
  return `${hint.usage}${alias} · ${hint.description}`;
}
