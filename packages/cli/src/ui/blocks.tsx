import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Box, Text, useStdout } from 'ink';
import os from 'node:os';
import type { PermissionRequest, Plan } from '@auraxis/core';

type BorderStyle = 'round' | 'single' | 'double';

export type ThemeName = 'dark' | 'light' | 'neon' | 'mono';

interface Palette {
  brand: string;
  text: string;
  muted: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  plan: string;
}

const THEMES: Record<ThemeName, Palette> = {
  dark: { brand: 'cyan', text: 'white', muted: 'gray', success: 'green', warning: 'yellow', danger: 'red', info: 'blue', plan: 'blue' },
  light: { brand: 'blue', text: 'black', muted: 'gray', success: 'green', warning: 'yellow', danger: 'red', info: 'blue', plan: 'blue' },
  neon: { brand: 'magenta', text: 'white', muted: 'gray', success: 'green', warning: 'yellow', danger: 'red', info: 'cyan', plan: 'cyan' },
  mono: { brand: 'white', text: 'white', muted: 'gray', success: 'white', warning: 'white', danger: 'white', info: 'white', plan: 'white' },
};

const ThemeContext = createContext<Palette>(THEMES.dark);

export function getTheme(name: ThemeName): Palette {
  return THEMES[name] || THEMES.dark;
}

export function ThemeProvider({ theme, children }: { theme: ThemeName; children: ReactNode }) {
  return <ThemeContext.Provider value={getTheme(theme)}>{children}</ThemeContext.Provider>;
}

function useTheme(): Palette {
  return useContext(ThemeContext);
}

export function Panel({
  title,
  color = 'cyan',
  border = 'round',
  children,
}: {
  title?: string;
  color?: string;
  border?: BorderStyle;
  children?: ReactNode;
}) {
  return (
    <Box borderStyle={border} borderColor={color} paddingX={1} paddingY={0} flexDirection="column">
      {title ? (
        <Text color={color} bold>
          {title}
        </Text>
      ) : null}
      {children}
    </Box>
  );
}

export function HeaderBar({ project, running }: { project: string; running: boolean }) {
  const theme = useTheme();
  return (
    <Panel title="Auraxis Agent" color={theme.brand}>
      <Text dimColor>{running ? '● 运行中' : '● 就绪'} · {project}</Text>
    </Panel>
  );
}

export function StatusBar({
  model,
  mode,
  sandbox,
  deepThink,
  running,
  iterations,
  toolCalls,
  tokens,
  themeName,
}: {
  model: string;
  mode: string;
  sandbox: string;
  deepThink: boolean;
  running: boolean;
  iterations: number;
  toolCalls: number;
  tokens: string;
  themeName: string;
}) {
  const theme = useTheme();
  return (
    <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
      <Text color={theme.muted}>
        {model} · {mode} · {sandbox} · deepThink {deepThink ? 'on' : 'off'} · {themeName}
      </Text>
      <Text color={theme.muted}>
        {running ? <Spinner /> : null} iter {iterations} / tools {toolCalls} / {tokens}
      </Text>
    </Box>
  );
}

function Spinner() {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((current) => (current + 1) % frames.length), 80);
    return () => clearInterval(timer);
  }, []);
  return <Text color="yellow">{frames[index]}</Text>;
}

export function PromptBar({
  input,
  running,
  bordered = true,
}: {
  input: string;
  running: boolean;
  bordered?: boolean;
}) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const columns = stdout.columns || 80;
  const [cursorOn, setCursorOn] = useState(true);
  useEffect(() => {
    if (running) return;
    const timer = setInterval(() => setCursorOn((current) => !current), 500);
    return () => clearInterval(timer);
  }, [running]);
  const maxInput = Math.max(12, columns - 8);
  const raw = input || (running ? '执行中 · Ctrl+C 取消' : '输入任务 · /help 查看命令');
  const oneLine = raw.replace(/\r?\n/g, '⏎');
  const display = oneLine.length > maxInput ? `${oneLine.slice(0, maxInput - 1)}…` : oneLine;
  const caret = running ? '' : cursorOn ? '▌' : ' ';
  const isPlaceholder = !input && !running;
  const body = (
    <Box flexDirection="row">
      <Text color={running ? theme.warning : theme.success} bold>
        {running ? '●' : '❯'}
      </Text>
      {isPlaceholder ? (
        <>
          <Text color={running ? theme.warning : theme.text}>{caret}</Text>
          <Text color={theme.muted} dimColor wrap="truncate">
            {display}
          </Text>
        </>
      ) : (
        <>
          <Text color={running ? theme.warning : theme.text} wrap="truncate">
            {' '}
            {display}
          </Text>
          <Text color={running ? theme.warning : theme.text}>{caret}</Text>
        </>
      )}
    </Box>
  );
  return bordered ? (
    <Panel color={running ? theme.warning : theme.success} border="single">
      {body}
    </Panel>
  ) : (
    body
  );
}

export function UserBlock({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Panel color={theme.success} border="single">
      <Text color={theme.success} bold>
        ❯ 你
      </Text>
      <Text color="white" wrap="wrap">
        {text}
      </Text>
    </Panel>
  );
}

export function AssistantBlock({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Box flexDirection="column">
      <Text color={theme.muted}>— Auraxis</Text>
      <RichText text={text} />
    </Box>
  );
}

function splitCodeBlocks(text: string): Array<{ code?: string; text?: string }> {
  const result: Array<{ code?: string; text?: string }> = [];
  const regex = /```(?:[\w-]+)?\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    if (match.index > last) result.push({ text: text.slice(last, match.index) });
    result.push({ code: match[1].replace(/\n$/, '') });
    last = regex.lastIndex;
  }
  if (last < text.length) result.push({ text: text.slice(last) });
  return result;
}

function RichText({ text }: { text: string }) {
  const theme = useTheme();
  const blocks = splitCodeBlocks(text);
  return (
    <Box flexDirection="column">
      {blocks.map((block, index) =>
        block.code !== undefined ? (
          <Text key={index} color={theme.info} wrap="wrap">
            {block.code}
          </Text>
        ) : (
          <MarkdownText key={index} text={block.text || ''} />
        ),
      )}
    </Box>
  );
}

function MarkdownText({ text }: { text: string }) {
  const theme = useTheme();
  const lines = text.split('\n');
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => {
        if (line.startsWith('### ')) {
          return (
            <Text key={index} color={theme.info} bold wrap="wrap">
              {line.slice(4)}
            </Text>
          );
        }
        if (line.startsWith('## ')) {
          return (
            <Text key={index} color={theme.info} bold wrap="wrap">
              {line.slice(3)}
            </Text>
          );
        }
        if (line.startsWith('# ')) {
          return (
            <Text key={index} color={theme.brand} bold wrap="wrap">
              {line.slice(2)}
            </Text>
          );
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <Text key={index} color={theme.success} wrap="wrap">
              • {line.slice(2)}
            </Text>
          );
        }
        if (line.startsWith('> ')) {
          return (
            <Text key={index} color={theme.muted} wrap="wrap">
              {line.slice(2)}
            </Text>
          );
        }
        return (
          <Text key={index} color={theme.text} wrap="wrap">
            {line}
          </Text>
        );
      })}
    </Box>
  );
}

function DiffBlock({ text, color }: { text: string; color: string }) {
  const lines = text.split('\n');
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={color} paddingX={1} marginTop={1}>
      {lines.map((line, index) => {
        const lineColor = line.startsWith('+') ? 'green' : line.startsWith('-') ? 'red' : 'dim';
        return (
          <Text
            key={index}
            color={lineColor === 'dim' ? undefined : lineColor}
            dimColor={lineColor === 'dim'}
            wrap="wrap"
          >
            {line}
          </Text>
        );
      })}
    </Box>
  );
}

export function ThinkingBlock({ text, expanded }: { text: string; expanded: boolean }) {
  const theme = useTheme();
  const preview = text.replace(/\s+/g, ' ').trim().slice(0, 90);
  return (
    <Panel color={theme.warning} border="single">
      <Text color={theme.warning}>
        ✦ 思考 {expanded ? '· Ctrl+T 收起' : '· Ctrl+T 展开'}
      </Text>
      <Text color="yellow" dimColor wrap="wrap">
        {expanded ? text : preview}
      </Text>
    </Panel>
  );
}

export function ToolBlock({
  name,
  summary,
  status,
  ok,
  error,
  duration,
  output,
}: {
  name: string;
  summary: string;
  status?: 'running' | 'done' | 'error';
  ok?: boolean;
  error?: string;
  duration?: number;
  output?: string;
}) {
  const theme = useTheme();
  const color = status === 'error' || ok === false ? theme.danger : status === 'done' ? theme.success : theme.info;
  const marker = status === 'error' ? '✗' : status === 'done' ? '✓' : status === 'running' ? '●' : '▸';
  return (
    <Panel color={color} border="single">
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={color} bold>
          {marker} {name}
        </Text>
        <Text dimColor>{duration !== undefined ? `${duration}ms` : status}</Text>
      </Box>
      <Text dimColor wrap="wrap">
        {error || summary || '…'}
      </Text>
      {output ? (
        <Text color={color} dimColor wrap="wrap">
          {output.split('\n').slice(0, 5).join('\n')}
          {output.split('\n').length > 5 ? `\n… 仅显示前 5 行` : ''}
        </Text>
      ) : null}
    </Panel>
  );
}

export function PlanBlock({ plan }: { plan: Plan }) {
  const theme = useTheme();
  const approved = new Set(plan.approvedSteps || []);
  return (
    <Panel color={theme.plan} border="double" title={`计划 · ${plan.tasks.length} 项`}>
      {plan.tasks.map((task) => (
        <Text key={task.id} color={task.status === 'completed' ? 'green' : approved.has(task.id) ? 'white' : 'dim'} wrap="wrap">
          {task.status === 'completed' ? '✓' : task.status === 'running' ? '●' : task.status === 'blocked' ? '✗' : '○'} {task.id}. {task.description}
        </Text>
      ))}
    </Panel>
  );
}

export function PermissionBlock({ request }: { request: PermissionRequest }) {
  const theme = useTheme();
  const color = request.danger === 'exec' || request.danger === 'agent' ? theme.danger : request.danger === 'write' ? theme.warning : theme.info;
  return (
    <Panel color={color} border="double" title="⚠ 需要确认">
      <Text color={color} bold>
        {request.tool}
      </Text>
      <Text dimColor wrap="wrap">
        {request.summary}
      </Text>
      <Text dimColor wrap="wrap">
        {JSON.stringify(request.args, null, 2)}
      </Text>
      {request.preview ? (
        <DiffBlock text={request.preview} color={color} />
      ) : null}
      <Text color="yellow">
        [y]允许一次 · [a]允许本会话 · [r]允许当前规则 · [n]拒绝
      </Text>
    </Panel>
  );
}

export function AskBlock({ question }: { question: string }) {
  const theme = useTheme();
  return (
    <Panel color={theme.success} border="double" title="需要你回答">
      <Text color={theme.success}>{question}</Text>
      <Text dimColor>输入回答后按 Enter</Text>
    </Panel>
  );
}

export function ErrorBlock({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Text color={theme.danger}>✗ {text}</Text>
  );
}

export function SystemBlock({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Text color={theme.info}>ℹ {text}</Text>
  );
}

function formatSessionTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${secs}`;
}

function QuickStartCard({
  icon = '',
  command,
  description,
  width,
}: {
  icon?: string;
  command: string;
  description: string;
  width?: number;
}) {
  const theme = useTheme();
  return (
    <Box width={width} flexGrow={width ? 0 : 1} borderStyle="round" borderColor={theme.muted} paddingX={1} flexDirection="column">
      <Box flexDirection="row">
        <Text color={theme.brand}>{icon}</Text>
        <Text color={theme.info} bold wrap="truncate">
          {' '}
          {command}
        </Text>
      </Box>
      <Text color={theme.text} dimColor wrap="truncate">
        {description}
      </Text>
    </Box>
  );
}

export function RichHomeCard({
  project,
  branch,
  model,
  mode,
  sandbox,
  version,
  running,
}: {
  project: string;
  branch: string;
  model: string;
  mode: string;
  sandbox: string;
  version: string;
  running: boolean;
}) {
  const theme = useTheme();
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const home = os.homedir();
  const displayProject = project.startsWith(home) ? `~${project.slice(home.length)}` : project;
  useEffect(() => {
    const timer = setInterval(() => setSessionSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const commands = [
    { command: '/chat', description: '开始对话' },
    { command: '/init', description: '初始化项目' },
    { command: '/run <file>', description: '运行文件' },
    { command: '/config', description: '配置设置' },
    { command: '/help', description: '查看帮助' },
  ];
  return (
    <Box flexDirection="column">
      <Panel color={theme.brand} border="round">
        <Box flexDirection="row">
          <Box flexDirection="column">
            <Box flexDirection="row" alignItems="center">
              <Text color={theme.brand} bold>
                ▲
              </Text>
              <Text color={theme.info} dimColor>
                {' '}
                ✦ ✧
              </Text>
              <Text color={theme.brand} bold>
                {' '}
                Auraxis Agent CLI
              </Text>
            </Box>
            <Text color={theme.text} dimColor>
              智能协作 · 代码理解 · 自动化执行
            </Text>
            <Box flexDirection="row" marginTop={1}>
              <Text color={theme.success} bold>
                ● 已连接到 Auraxis Agent
              </Text>
              <Text color={theme.muted}>
                {' '}
                · 版本 {version}
              </Text>
            </Box>
          </Box>
          <Box flexDirection="column" marginLeft={2}>
            <Text color={theme.muted}>
              cwd: <Text color={theme.text}>{displayProject}</Text>
            </Text>
            <Text color={theme.muted}>
              branch: <Text color={theme.text}>{branch}</Text>
            </Text>
            <Text color={theme.muted}>
              model: <Text color={theme.text}>{model}</Text>
            </Text>
            <Text color={theme.muted}>
              mode: <Text color={theme.text}>{mode}</Text>
            </Text>
            <Text color={theme.muted}>
              sandbox: <Text color={theme.text}>{sandbox}</Text>
            </Text>
            <Text color={theme.muted}>
              session: <Text color={theme.brand}>{formatSessionTime(sessionSeconds)}</Text>
            </Text>
            <Text color={theme.info} dimColor>
              {running ? '● 运行中' : '● 就绪'}
            </Text>
          </Box>
        </Box>
      </Panel>
      <Panel color={theme.muted} border="single" title="快速开始">
        <Box flexDirection="row">
          {commands.map((command) => (
            <QuickStartCard key={command.command} {...command} />
          ))}
        </Box>
      </Panel>
      <Panel color={theme.info} border="single">
        <Text color={theme.warning}>
          💡 提示
        </Text>
        <Text color={theme.text} dimColor>
          输入 natural language 或使用 / 命令触发智能能力 ·
        </Text>
        <Text color={theme.info}>
          /help 查看全部命令
        </Text>
      </Panel>
    </Box>
  );
}

function CommandChip({
  icon,
  label,
  selected,
}: {
  icon: string;
  label: string;
  selected: boolean;
}) {
  const theme = useTheme();
  return (
    <Box
      borderStyle="round"
      borderColor={selected ? theme.brand : theme.muted}
      paddingX={1}
      marginRight={1}
    >
      <Text color={selected ? theme.brand : theme.info} bold={selected} wrap="wrap">
        {icon} {label}
      </Text>
    </Box>
  );
}

export function HomeCard({
  project,
  branch,
  model,
  mode,
  sandbox,
  version,
  running,
  input,
  homeFocus,
  selectedCommand,
  appMode,
}: {
  project: string;
  branch: string;
  model: string;
  mode: string;
  sandbox: string;
  version: string;
  running: boolean;
  input: string;
  homeFocus: 'input' | 'commands';
  selectedCommand: number;
  appMode: 'chat' | 'work' | 'code';
}) {
  const theme = useTheme();
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const home = os.homedir();
  const displayProject = project.startsWith(home) ? `~${project.slice(home.length)}` : project;

  useEffect(() => {
    const timer = setInterval(() => setSessionSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const commands = [
    { icon: '▣', command: '/chat', description: '对话' },
    { icon: '▦', command: '/work', description: '文档协作' },
    { icon: '⌘', command: '/code', description: '代码执行' },
    { icon: '◈', command: '/agents', description: '多 Agent' },
    { icon: '⛁', command: '/mcp', description: '扩展集成' },
  ];

  return (
    <Box flexDirection="column">
      <Panel color={theme.brand} border="round">
        <Box flexDirection="row">
          <Box flexDirection="column" flexGrow={1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text color={theme.brand} bold>
                ❯_ Auraxis Agent CLI
              </Text>
            </Box>
            <Box flexDirection="row" marginTop={1}>
              {commands.map((command, index) => (
                <CommandChip
                  key={command.command}
                  icon={command.icon}
                  label={command.command}
                  selected={homeFocus === 'commands' && selectedCommand === index}
                />
              ))}
            </Box>
            <Box marginTop={1}>
              <Text color={theme.muted}>
                Tab 切换命令 · ← → 选择 · Enter 执行 · 1-5 直达
              </Text>
            </Box>
          </Box>
          <Box flexDirection="column" marginLeft={2}>
            <Text color={theme.muted}>{displayProject}</Text>
            <Text color={theme.muted}>{branch}</Text>
            <Text color={theme.muted}>{model}</Text>
            <Text color={theme.muted}>{appMode.toUpperCase()}</Text>
            <Text color={theme.brand}>{formatSessionTime(sessionSeconds)}</Text>
          </Box>
        </Box>
      </Panel>
      <PromptBar input={input} running={running} />
    </Box>
  );
}

export function LegacyHomeCard({
  project,
  branch,
  model,
  mode,
  sandbox,
  version,
  running,
  input,
  homeFocus,
  selectedCommand,
}: {
  project: string;
  branch: string;
  model: string;
  mode: string;
  sandbox: string;
  version: string;
  running: boolean;
  input: string;
  homeFocus: 'input' | 'commands';
  selectedCommand: number;
}) {
  const theme = useTheme();
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const home = os.homedir();
  const { stdout } = useStdout();
  const wideFooter = (stdout.columns || 80) >= 108;
  const displayProject = project.startsWith(home) ? `~${project.slice(home.length)}` : project;

  useEffect(() => {
    const timer = setInterval(() => setSessionSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const footerCommands = [
    { icon: '▣', command: '/chat', description: '开始对话' },
    { icon: '◇', command: '/init', description: '初始化项目' },
    { icon: '▸', command: '/run <file>', description: '运行文件' },
    { icon: '☰', command: '/config', description: '配置设置' },
    { icon: '?', command: '/help', description: '查看更多命令' },
  ];

  return (
    <Box flexDirection="column">
      <Panel color={theme.brand} border="round">
        <Box flexDirection="row">
          <Box flexDirection="column" flexGrow={1}>
            <Box flexDirection="row" alignItems="flex-start">
              <Text color={theme.info} bold>
                ❯_
              </Text>
              <Box flexDirection="column" marginLeft={1}>
                <Text color={theme.brand} bold>
                  Auraxis
                </Text>
                <Text color={theme.text} bold>
                  Agent CLI
                </Text>
                <Box flexDirection="row" marginTop={1}>
                  <Text color={theme.success} bold>
                    ● 已连接到 Auraxis Agent
                  </Text>
                  <Text color={theme.muted}>
                    {' '}· 版本 {version}
                  </Text>
                </Box>
              </Box>
            </Box>
          </Box>
          <Text color={theme.muted}>
            {'│\n│\n│\n│'}
          </Text>
          <Box flexDirection="column">
            <Text color={theme.muted}>
              ▣ 工作目录
            </Text>
            <Text color={theme.text}>
              {displayProject}
            </Text>
            <Text color={theme.muted}>
              ⑂ 当前分支
            </Text>
            <Text color={theme.text}>
              {branch}
            </Text>
            <Text color={theme.muted}>
              ◷ 会话时间
            </Text>
            <Text color={theme.brand}>
              {formatSessionTime(sessionSeconds)}
            </Text>
          </Box>
        </Box>
      </Panel>
      <Panel color={theme.muted} border="single">
        <Box flexDirection="column">
          <Box flexDirection="row">
            {wideFooter
              ? footerCommands.map((command) => (
                  <QuickStartCard key={command.command} {...command} width={20} />
                ))
              : footerCommands.slice(0, 3).map((command) => (
                  <QuickStartCard key={command.command} {...command} width={24} />
                ))}
          </Box>
          {!wideFooter ? (
            <Box flexDirection="row" marginTop={1}>
              {footerCommands.slice(3).map((command) => (
                <QuickStartCard key={command.command} {...command} width={34} />
              ))}
            </Box>
          ) : null}
        </Box>
      </Panel>
      <PromptBar input={input} running={running} />
    </Box>
  );
}

export function CompactHomeCard({
  project,
  branch,
  model,
  mode,
  sandbox,
  version,
  running,
  input,
}: {
  project: string;
  branch: string;
  model: string;
  mode: string;
  sandbox: string;
  version: string;
  running: boolean;
  input: string;
}) {
  const theme = useTheme();
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const home = os.homedir();
  const { stdout } = useStdout();
  const wideFooter = (stdout.columns || 80) >= 108;
  const displayProject = project.startsWith(home) ? `~${project.slice(home.length)}` : project;

  useEffect(() => {
    const timer = setInterval(() => setSessionSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const footerCommands = [
    { icon: '▣', command: '/chat', description: '开始对话' },
    { icon: '◇', command: '/init', description: '初始化项目' },
    { icon: '▸', command: '/run <file>', description: '运行文件' },
    { icon: '☰', command: '/config', description: '配置设置' },
    { icon: '?', command: '/help', description: '查看更多命令' },
  ];

  return (
    <Box flexDirection="column">
      <Panel color={theme.brand} border="round">
        <Box flexDirection="row">
          <Box flexDirection="column" flexGrow={1}>
            <Box flexDirection="row">
              <Text color={theme.info} bold>
                ❯_
              </Text>
              <Text color={theme.brand} bold>
                {'  '}Auraxis Agent
              </Text>
              <Text color={theme.muted} dimColor>
                {' '}(v{version})
              </Text>
            </Box>
            <Text color={theme.text}>
              Tips: 输入自然语言开始对话，或使用 / 命令
            </Text>
          </Box>
          <Text color={theme.muted}>
            {'│\n│\n│\n│\n│'}
          </Text>
          <Box flexDirection="column">
            <Text color={theme.muted}>
              cwd: <Text color={theme.text}>{displayProject}</Text>
            </Text>
            <Text color={theme.muted}>
              branch: <Text color={theme.text}>{branch}</Text>
            </Text>
            <Text color={theme.muted}>
              model: <Text color={theme.text}>{model}</Text>
            </Text>
            <Text color={theme.muted}>
              session: <Text color={theme.brand}>{formatSessionTime(sessionSeconds)}</Text>
            </Text>
          </Box>
        </Box>
      </Panel>
      <Panel color={theme.muted} border="single">
        <Box flexDirection="column">
          <Box flexDirection="row">
            {wideFooter
              ? footerCommands.map((command) => (
                  <QuickStartCard key={command.command} {...command} width={20} />
                ))
              : footerCommands.slice(0, 3).map((command) => (
                  <QuickStartCard key={command.command} {...command} width={24} />
                ))}
          </Box>
          {!wideFooter ? (
            <Box flexDirection="row" marginTop={1}>
              {footerCommands.slice(3).map((command) => (
                <QuickStartCard key={command.command} {...command} width={34} />
              ))}
            </Box>
          ) : null}
        </Box>
      </Panel>
      <PromptBar input={input} running={running} />
    </Box>
  );
}
