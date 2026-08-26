import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Box, Text, useStdout } from 'ink';
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

export function PromptBar({ input, running }: { input: string; running: boolean }) {
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
  return (
    <Panel color={running ? theme.warning : theme.success} border="single">
      <Box flexDirection="row">
        <Text color={running ? theme.warning : theme.success} bold>
          {running ? '●' : '❯'}
        </Text>
        <Text
          color={running ? theme.warning : theme.text}
          dimColor={isPlaceholder}
          wrap="truncate"
        >
          {' '}
          {display}
          {caret}
        </Text>
      </Box>
    </Panel>
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
