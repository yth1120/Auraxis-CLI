import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Box, Text, useStdout } from 'ink';
import os from 'node:os';
import type { ModelChoice, PermissionRequest, Plan, SkillRecord } from '@auraxis/core';
import { COMMAND_HINTS, commandHintLabel, type CommandHint } from './commands.js';
import { HOME_COMMANDS, buildBlockTitle, shortenProjectPath } from './home.js';
import { isDiffCodeBlock, parseInlineMarkdown, splitCodeBlocks } from './markdown.js';
import { stepSummary, timelineNode, truncateByWidth } from './text.js';
import type { ActiveCommand, ActivityItem, ChoiceOption, ChoicePickerState } from './terminal-model.js';

type BorderStyle = 'round' | 'single' | 'double';
type ToolStatus = 'idle' | 'running' | 'done' | 'error' | 'aborted';

export type ThemeName = 'dark' | 'light' | 'neon' | 'mono';

interface Palette {
  brand: string;
  brandFrom: string;
  brandTo: string;
  text: string;
  muted: string;
  border: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  plan: string;
  surface: string;
  surfaceAlt: string;
  highlight: string;
}

const THEMES: Record<ThemeName, Palette> = {
  dark: {
    brand: '#A6A4C2',
    brandFrom: '#8C8AA8',
    brandTo: '#D9D7E8',
    text: '#F1F1EE',
    muted: '#9DA2A9',
    border: '#3A3E45',
    success: '#4FAE86',
    warning: '#B8935A',
    danger: '#B07177',
    info: '#8C8AA8',
    plan: '#8C8AA8',
    surface: '#23262C',
    surfaceAlt: '#2A2E35',
    highlight: '#D9D7E8',
  },
  light: {
    brand: '#6A6884',
    brandFrom: '#292C32',
    brandTo: '#6A6884',
    text: '#111216',
    muted: '#61676F',
    border: '#D5D8DE',
    success: '#4F7C68',
    warning: '#B97F3E',
    danger: '#A25B60',
    info: '#6A6884',
    plan: '#6A6884',
    surface: '#FFFFFF',
    surfaceAlt: '#EDEFF3',
    highlight: '#6A6884',
  },
  neon: {
    brand: '#D8C7F0',
    brandFrom: '#8C8AA8',
    brandTo: '#D9D7E8',
    text: '#F1F1EE',
    muted: '#9DA2A9',
    border: '#57506B',
    success: '#8FE3C1',
    warning: '#F3C57B',
    danger: '#E9A2A7',
    info: '#A6A4C2',
    plan: '#A6A4C2',
    surface: '#1E1726',
    surfaceAlt: '#2A2033',
    highlight: '#D9D7E8',
  },
  mono: {
    brand: '#F1F1EE',
    brandFrom: '#F1F1EE',
    brandTo: '#F1F1EE',
    text: '#F1F1EE',
    muted: '#9DA2A9',
    border: '#4A4D52',
    success: '#F1F1EE',
    warning: '#F1F1EE',
    danger: '#F1F1EE',
    info: '#F1F1EE',
    plan: '#F1F1EE',
    surface: '#111111',
    surfaceAlt: '#1D1D1D',
    highlight: '#F1F1EE',
  },
};

const ThemeContext = createContext<Palette>(THEMES.dark);

export function getTheme(name: ThemeName): Palette {
  return THEMES[name] || THEMES.dark;
}

export function ThemeProvider({ theme, children }: { theme: ThemeName; children: ReactNode }) {
  return <ThemeContext.Provider value={getTheme(theme)}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Palette {
  return useContext(ThemeContext);
}

export function Panel({
  title,
  color,
  border = 'round',
  children,
  width,
  marginLeft,
  marginTop,
  flexGrow,
  paddingY = 0,
}: {
  title?: string;
  color?: string;
  border?: BorderStyle;
  children?: ReactNode;
  width?: number;
  marginLeft?: number;
  marginTop?: number;
  flexGrow?: number;
  paddingY?: number;
}) {
  const theme = useTheme();
  return (
    <Box
      borderStyle={border}
      borderColor={color || theme.brand}
      paddingX={1}
      paddingY={paddingY}
      flexDirection="column"
      width={width}
      marginLeft={marginLeft}
      marginTop={marginTop}
      flexGrow={flexGrow}
    >
      {title ? (
        <Text color={color || theme.brand} bold>
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
    <Box flexDirection="row">
      <Text color={theme.brand} bold>
        ▲ Auraxis
      </Text>
      <Text color={theme.muted} dimColor wrap="truncate">
        {' '}· {project}
      </Text>
      {running ? (
        <Text color={theme.warning} bold>
          {' '}● 运行中
        </Text>
      ) : null}
    </Box>
  );
}

export function PathBar({ project }: { project: string }) {
  const theme = useTheme();
  const pathLabel = shortenProjectPath(project, os.homedir(), 34);
  return (
    <Box marginTop={1} marginBottom={0}>
      <Text wrap="truncate">
        <Text color={theme.muted}>路径 </Text>
        <Text color={theme.text}>{pathLabel}</Text>
      </Text>
    </Box>
  );
}

export function StatusBar({
  model,
  permission,
  reasoningEffort,
  running,
  currentTool,
}: {
  model: string;
  permission: string;
  reasoningEffort: string;
  running: boolean;
  currentTool?: string;
}) {
  const theme = useTheme();
  const [since, setSince] = useState<number | null>(null);
  useEffect(() => {
    if (!running) {
      setSince(null);
      return;
    }
    setSince((value) => value ?? Date.now());
    const timer = setInterval(() => setSince((value) => value ?? Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const permissionColor =
    permission === 'auto' ? theme.success : permission === 'plan' ? theme.plan : permission === 'ask' ? theme.warning : theme.info;
  const elapsed = running && since ? Date.now() - since : 0;
  return (
    <Box flexDirection="column" marginTop={0}>
      <Text wrap="truncate">
        <Text color={theme.muted}>模型 </Text>
        <Text color={theme.text}>{model}</Text>
        <Text color={theme.muted}> · 模式 </Text>
        <Text color={permissionColor}>{permission}</Text>
        <Text color={theme.muted}> · 思考 </Text>
        <Text color={theme.text}>{reasoningEffort}</Text>
      </Text>
      {running ? (
        <Text color={theme.warning} wrap="truncate">
          <Spinner /> <Text color={theme.text}>{currentTool || '思考中'}</Text>
          {elapsed > 1000 ? <Text color={theme.muted}> · {formatDuration(elapsed)}</Text> : null}
        </Text>
      ) : null}
    </Box>
  );
}

function Spinner() {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const [index, setIndex] = useState(0);
  const theme = useTheme();
  useEffect(() => {
    const timer = setInterval(() => setIndex((current) => (current + 1) % frames.length), 80);
    return () => clearInterval(timer);
  }, []);
  return <Text color={theme.warning}>{frames[index]}</Text>;
}

function formatDuration(duration?: number): string {
  if (duration === undefined) return '';
  if (duration < 1000) return `${duration}ms`;
  if (duration < 60_000) {
    const seconds = duration / 1000;
    return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(duration / 60_000);
  const seconds = Math.floor((duration % 60_000) / 1000);
  return `${minutes}m${seconds}s`;
}

function resolveToolStatus(
  theme: Palette,
  status?: ToolStatus,
  ok?: boolean,
): { kind: ToolStatus; color: string; marker: string } {
  const kind: ToolStatus =
    status === 'error' || ok === false
      ? 'error'
      : status === 'done' || ok === true
        ? 'done'
        : status || 'idle';
  const color =
    kind === 'error'
      ? theme.danger
      : kind === 'done'
        ? theme.success
        : kind === 'aborted'
          ? theme.muted
          : kind === 'running'
            ? theme.warning
            : theme.info;
  const marker =
    kind === 'error' ? '✗' : kind === 'done' ? '✓' : kind === 'aborted' ? '⏹' : kind === 'running' ? '●' : '▸';
  return { kind, color, marker };
}

const OUTPUT_PREFIX = '⎿ ';
const CODE_OUTPUT_PREFIX = '  ⎿ ';

function outputBlockText(lines: string[], limit: number, limitHint: number): string {
  const shown = lines.slice(0, limit).map((line) => `${OUTPUT_PREFIX}${truncateByWidth(line, 116)}`);
  if (lines.length > limit) shown.push(`${OUTPUT_PREFIX}… 共 ${lines.length} 行 · Ctrl+O 展开至 ${limitHint} 行`);
  return shown.join('\n');
}

function ToolStatusRow({
  name,
  summary,
  status,
  ok,
  error,
  duration,
  output,
  showOutput = false,
  outputLimit = 3,
  compact = false,
  timeline,
}: {
  name: string;
  summary?: string;
  status?: ToolStatus;
  ok?: boolean;
  error?: string;
  duration?: number;
  output?: string;
  showOutput?: boolean;
  outputLimit?: number;
  compact?: boolean;
  /** 执行视图的时间轴连接符，提供时使用纵向引导图文排版。 */
  timeline?: { node: string; prefix: string };
}) {
  const theme = useTheme();
  const resolved = resolveToolStatus(theme, status, ok);
  const trimmedSummary = summary?.trim();
  const detail = error || (trimmedSummary && trimmedSummary !== name ? trimmedSummary : '');
  const outputLines = output ? output.split(/\r?\n/) : [];
  const safeLimit = Math.max(1, Math.floor(outputLimit));
  const hasOutput = showOutput && outputLines.length > 0;
  const detailColor =
    resolved.kind === 'error' ? theme.danger : resolved.kind === 'done' ? theme.success : theme.muted;
  const detailDim = resolved.kind === 'done' || resolved.kind === 'idle';
  const nameColor = resolved.kind === 'running' ? theme.text : resolved.color;
  const nameBold = resolved.kind === 'running' || resolved.kind === 'error';
  return (
    <Box flexDirection="column" marginTop={compact || timeline ? 0 : 1}>
      <Box flexDirection="row" flexShrink={0}>
        {timeline ? <Text color={theme.border}>{timeline.node} </Text> : null}
        {resolved.kind === 'running' ? (
          <Box marginRight={1}>
            <Spinner />
          </Box>
        ) : (
          <Text color={resolved.color} bold={nameBold} wrap="truncate">
            {resolved.marker}{' '}
          </Text>
        )}
        <Text color={nameColor} bold={nameBold} wrap="truncate">
          {toolIcon(name)} {name}
        </Text>
        <Box flexGrow={1} flexShrink={1}>
          {detail ? (
            <Text
              color={resolved.kind === 'error' ? theme.danger : theme.muted}
              dimColor={detailDim}
              wrap="truncate"
            >
              {' '}
              {detail}
            </Text>
          ) : null}
        </Box>
        <Text color={theme.muted} dimColor>
          {formatDuration(duration)}
        </Text>
      </Box>
      {hasOutput ? (
        <Box flexDirection="row" flexShrink={0}>
          <Text color={theme.border}>{timeline ? timeline.prefix : '  '}</Text>
          <Text
            color={resolved.kind === 'error' ? theme.danger : theme.muted}
            dimColor={resolved.kind === 'done'}
            wrap="wrap"
          >
            {outputBlockText(outputLines, safeLimit, 12)}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function ActivityRow({
  item,
  first,
  last,
  showOutput,
  outputLimit = 3,
}: {
  item: ActivityItem;
  first: boolean;
  last: boolean;
  showOutput: boolean;
  outputLimit?: number;
}) {
  return (
    <ToolStatusRow
      name={item.name}
      summary={item.summary}
      status={item.status}
      error={item.error}
      duration={item.duration}
      output={item.output}
      showOutput={showOutput}
      outputLimit={outputLimit}
      timeline={timelineNode(first, last)}
    />
  );
}

export function ExecutionPanel({
  items,
  running,
  expanded = false,
}: {
  items: ActivityItem[];
  running: boolean;
  expanded?: boolean;
}) {
  const theme = useTheme();
  const [tick, setTick] = useState(0);
  const hasRunningItem = items.some((item) => item.status === 'running');
  useEffect(() => {
    if (!hasRunningItem) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [hasRunningItem]);
  if (!items.length) return null;
  const activeCount = items.filter((item) => item.status === 'running').length;
  const errorCount = items.filter((item) => item.status === 'error').length;
  const startTimes = items.map((item) => item.startedAt).filter((value): value is number => typeof value === 'number');
  const finishTimes = items.map((item) => item.finishedAt).filter((value): value is number => typeof value === 'number');
  const live = running || activeCount > 0;
  const earliestStart = startTimes.length > 0 ? Math.min(...startTimes) : 0;
  const latestFinish = finishTimes.length > 0 ? Math.max(...finishTimes) : 0;
  const endTime = live ? Date.now() : latestFinish || Date.now();
  const elapsed = earliestStart > 0 ? Math.max(0, endTime - earliestStart) : 0;
  void tick;
  const visibleItems = expanded ? items : items.slice(-6);
  const hiddenCount = items.length - visibleItems.length;
  const headingColor = running ? theme.warning : errorCount ? theme.danger : theme.success;
  const heading = running ? '执行中' : errorCount ? '执行失败' : '已完成';
  const headingMarker = running ? '●' : errorCount ? '✗' : '✓';
  return (
    <Box
      flexDirection="column"
      paddingX={1}
      marginTop={1}
      backgroundColor={theme.surfaceAlt}
    >
      <Box flexDirection="row" flexShrink={0}>
        <Text color={headingColor} bold wrap="truncate">
          {headingMarker} {heading}
        </Text>
        <Text color={theme.muted} wrap="truncate">
          {' '}
          · {stepSummary(items.length, errorCount)}
          {elapsed > 0 ? ` · ${formatDuration(elapsed)}` : ''}
        </Text>
        {hiddenCount > 0 ? (
          <Text color={theme.muted} dimColor wrap="truncate">
            {'  '}
            {expanded ? 'Ctrl+O 收起' : `+${hiddenCount} 步 · Ctrl+O`}
          </Text>
        ) : null}
      </Box>
      <Box flexDirection="column">
        {visibleItems.map((item, index) => (
          <ActivityRow
            key={item.id || `${item.kind}-${item.name}-${index}`}
            item={item}
            first={index === 0}
            last={index === visibleItems.length - 1}
            showOutput={expanded || item.status === 'error'}
            outputLimit={expanded ? 12 : 3}
          />
        ))}
      </Box>
    </Box>
  );
}

export function CommandHintsBar({
  suggestions,
  selected,
  width,
}: {
  suggestions: CommandHint[];
  selected: number;
  width?: number;
}) {
  const theme = useTheme();
  if (!suggestions.length) return null;
  return (
    <Box
      flexDirection="column"
      paddingX={1}
      marginTop={1}
      backgroundColor={theme.surfaceAlt}
      width={width}
    >
      {suggestions.map((hint, index) => (
        <Box key={hint.command} flexDirection="row" flexShrink={0}>
          <Text color={index === selected ? theme.text : theme.muted} bold={index === selected}>
            {index === selected ? '▸' : ' '}
          </Text>
          <Text
            color={index === selected ? theme.text : theme.muted}
            bold={index === selected}
            wrap="truncate"
          >
            {' '}
            {hint.command}
          </Text>
          <Box flexGrow={1} flexShrink={1}>
            <Text color={theme.muted} dimColor wrap="truncate">
              {' '}
              {hint.description}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export function HelpPanel() {
  const theme = useTheme();
  const { stdout } = useStdout();
  const maxPerGroup = (stdout.rows || 24) < 32 ? 2 : 3;
  const groups = [...new Set(COMMAND_HINTS.map((hint) => hint.group))].map((group) => ({
    group,
    hints: COMMAND_HINTS.filter((hint) => hint.group === group),
  }));
  return (
    <Panel color={theme.brand} border="double" title="Auraxis · 帮助">
      <Text color={theme.muted}>快捷键：Ctrl+P 帮助 · Ctrl+J 换行 · Ctrl+T 思考 · Ctrl+O 执行详情 · Ctrl+Z 撤回排队 · Ctrl+C 取消/退出</Text>
      <Text color={theme.muted}>Ctrl+L 清空对话 · PgUp/PgDn/滚轮 浏览历史 · 输入 / 查看命令联想</Text>
      <Box flexDirection="column" marginTop={1}>
        {groups.map(({ group, hints }) => (
          <Box key={group} flexDirection="column" marginTop={1}>
            <Text color={theme.info} bold>
              {group}
            </Text>
            {hints.slice(0, maxPerGroup).map((hint) => (
              <Text key={hint.command} color={theme.text} wrap="truncate">
                {'  '} {commandHintLabel(hint)}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
      <Text color={theme.warning}>Ctrl+P / Esc</Text>
    </Panel>
  );
}

export function ActiveCommandBar({ command }: { command: ActiveCommand }) {
  const theme = useTheme();
  return (
    <Text color={theme.info} bold>
      ◈ {command.label}
      <Text color={theme.muted} dimColor>
        {' '}· Esc
      </Text>
    </Text>
  );
}

export function PendingQueue({ items }: { items: string[] }) {
  const theme = useTheme();
  if (!items.length) return null;
  const recent = items.slice(-3);
  const hiddenCount = items.length - recent.length;
  return (
    <Box
      flexDirection="column"
      marginTop={1}
      paddingX={1}
      backgroundColor={theme.surfaceAlt}
    >
      <Text color={theme.warning} bold wrap="truncate">
        ⏳ 等待执行 · {items.length}
      </Text>
      {recent.map((item, index) => (
        <Text key={`${index}-${item}`} color={theme.text} wrap="truncate">
          <Text color={theme.muted}>{items.length - recent.length + index + 1}.</Text>
          {' '}
          {truncateByWidth(item.replace(/\s+/g, ' ').trim(), 90)}
        </Text>
      ))}
      {hiddenCount > 0 ? (
        <Text color={theme.muted} dimColor>
          … 还有 {hiddenCount} 条
        </Text>
      ) : null}
      <Text color={theme.muted} dimColor>
        Ctrl+Z 撤回最后一个
      </Text>
    </Box>
  );
}

export function PromptBar({
  input,
  running,
  bordered = false,
  width,
  placeholder,
}: {
  input: string;
  running: boolean;
  bordered?: boolean;
  width?: number;
  placeholder?: string;
}) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const columns = stdout.columns || 80;
  const availableWidth = width ?? Math.max(12, columns - (bordered ? 8 : 2));
  const [cursorOn, setCursorOn] = useState(true);
  useEffect(() => {
    const timer = setInterval(() => setCursorOn((current) => !current), 500);
    return () => clearInterval(timer);
  }, []);
  const maxInput = Math.max(12, availableWidth - 8);
  const raw = input || (running ? '' : placeholder || '输入任务…');
  const oneLine = raw.replace(/\r?\n/g, '⏎');
  const display = truncateByWidth(oneLine, maxInput);
  const caret = cursorOn ? '▌' : ' ';
  const isPlaceholder = !input && !running;
  const body = (
    <Box flexDirection="row" width={availableWidth}>
      <Text color={theme.brand} bold>
        ❯
      </Text>
      {isPlaceholder ? (
        <>
          <Text color={theme.text}>{caret}</Text>
          <Text color={theme.muted} dimColor wrap="truncate">
            {display}
          </Text>
        </>
      ) : (
        <>
          <Text color={theme.text} wrap="truncate">
            {' '}
            {display}
          </Text>
          <Text color={theme.text}>{caret}</Text>
        </>
      )}
    </Box>
  );
  return bordered ? (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.border}
      borderTop={true}
      borderBottom={true}
      borderLeft={false}
      borderRight={false}
      width={width}
    >
      {body}
    </Box>
  ) : (
    body
  );
}

export function UserBlock({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Box flexDirection="row" marginBottom={1}>
      <Text color={theme.brand} bold>
        {'❯ '}
      </Text>
      <Box flexGrow={1}>
        <Text color={theme.text} wrap="wrap">
          <InlineMarkdown
            text={text}
            color={theme.text}
            strongColor={theme.highlight}
            codeColor={theme.info}
          />
        </Text>
      </Box>
    </Box>
  );
}

export function AssistantBlock({ text }: { text: string }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <RichText text={text} />
    </Box>
  );
}

function RichText({ text }: { text: string }) {
  const theme = useTheme();
  const blocks = splitCodeBlocks(text);
  return (
    <Box flexDirection="column">
      {blocks.map((block, index) =>
        block.code !== undefined ? (
          isDiffCodeBlock(block) ? (
            <DiffTextBlock key={index} text={block.code} />
          ) : (
            <Box
              key={index}
              backgroundColor={theme.surfaceAlt}
              paddingX={1}
              marginTop={1}
              flexShrink={0}
            >
              <Text color={theme.text} wrap="wrap">
                {block.code}
              </Text>
            </Box>
          )
        ) : (
          <MarkdownText key={index} text={block.text || ''} />
        ),
      )}
    </Box>
  );
}

function InlineMarkdown({
  text,
  color,
  strongColor,
  codeColor,
}: {
  text: string;
  color: string;
  strongColor: string;
  codeColor: string;
}) {
  const segments = parseInlineMarkdown(text);
  return (
    <Text color={color} wrap="wrap">
      {segments.map((segment, index) => {
        if (segment.type === 'code') {
          return (
            <Text key={index} color={codeColor}>
              {segment.text}
            </Text>
          );
        }
        if (segment.type === 'strong') {
          return (
            <Text key={index} color={strongColor} bold>
              {segment.text}
            </Text>
          );
        }
        return segment.text;
      })}
    </Text>
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
              <InlineMarkdown
                text={line.slice(4)}
                color={theme.info}
                strongColor={theme.highlight}
                codeColor={theme.info}
              />
            </Text>
          );
        }
        if (line.startsWith('## ')) {
          return (
            <Text key={index} color={theme.info} bold wrap="wrap">
              <InlineMarkdown
                text={line.slice(3)}
                color={theme.info}
                strongColor={theme.highlight}
                codeColor={theme.info}
              />
            </Text>
          );
        }
        if (line.startsWith('# ')) {
          return (
            <Text key={index} color={theme.brand} bold wrap="wrap">
              <InlineMarkdown
                text={line.slice(2)}
                color={theme.brand}
                strongColor={theme.highlight}
                codeColor={theme.info}
              />
            </Text>
          );
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <Text key={index} color={theme.text} wrap="wrap">
              <Text color={theme.muted}>• </Text>
              <InlineMarkdown
                text={line.slice(2)}
                color={theme.text}
                strongColor={theme.highlight}
                codeColor={theme.info}
              />
            </Text>
          );
        }
        if (line.startsWith('> ')) {
          return (
            <Text key={index} color={theme.muted} wrap="wrap">
              <Text color={theme.info}>│ </Text>
              <InlineMarkdown
                text={line.slice(2)}
                color={theme.muted}
                strongColor={theme.text}
                codeColor={theme.info}
              />
            </Text>
          );
        }
        return (
          <InlineMarkdown
            key={index}
            text={line}
            color={theme.text}
            strongColor={theme.highlight}
            codeColor={theme.info}
          />
        );
      })}
    </Box>
  );
}

function DiffLines({ text }: { text: string }) {
  const theme = useTheme();
  const lines = text.split('\n');
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => {
        const lineColor = line.startsWith('+') ? theme.success : line.startsWith('-') ? theme.danger : theme.muted;
        return (
          <Text
            key={index}
            color={lineColor}
            dimColor={lineColor === theme.muted}
            wrap="wrap"
          >
            {line}
          </Text>
        );
      })}
    </Box>
  );
}

function DiffTextBlock({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Box backgroundColor={theme.surfaceAlt} paddingX={1} marginTop={1} flexShrink={0}>
      <DiffLines text={text} />
    </Box>
  );
}

function DiffBlock({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <Box backgroundColor={theme.surfaceAlt} paddingX={1} marginTop={1} flexShrink={0}>
      <DiffLines text={text} />
    </Box>
  );
}

export function ThinkingBlock({ text, expanded }: { text: string; expanded: boolean }) {
  const theme = useTheme();
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.warning} bold>
        {expanded ? '▾' : '▸'} ✦ 思考
        <Text color={theme.muted} dimColor>
          {' '}
          · Ctrl+T
        </Text>
      </Text>
      {expanded ? (
        <Box marginLeft={2}>
          <Text color={theme.muted} dimColor wrap="wrap">
            {text}
          </Text>
        </Box>
      ) : null}
    </Box>
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
  status?: 'running' | 'done' | 'error' | 'aborted';
  ok?: boolean;
  error?: string;
  duration?: number;
  output?: string;
}) {
  return (
    <ToolStatusRow
      name={name}
      summary={summary}
      status={status}
      ok={ok}
      error={error}
      duration={duration}
      output={output}
      showOutput
    />
  );
}

function SkillCard({
  skill,
  selected,
  width,
}: {
  skill: SkillRecord;
  selected: boolean;
  width: number;
}) {
  const theme = useTheme();
  const fileName = skill.file.split(/[\\/]/).pop() || skill.file;
  const description = (skill.description || '暂无描述').replace(/\s+/g, ' ').trim().slice(0, 96);
  return (
    <Box
      width={width}
      marginRight={1}
      marginBottom={1}
      borderStyle="round"
      borderColor={selected ? theme.brandTo : theme.border}
      backgroundColor={selected ? theme.surfaceAlt : undefined}
      paddingX={1}
      flexDirection="column"
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={selected ? theme.text : theme.brandTo} bold={selected} wrap="truncate">
          {selected ? '▸ ' : '  '}◆ {skill.name}
        </Text>
        <Text color={theme.muted} wrap="truncate">
          #{skill.id}
        </Text>
      </Box>
      <Text color={selected ? theme.text : theme.muted} dimColor wrap="truncate">
        {description}
      </Text>
      <Text color={theme.muted} wrap="truncate">
        {fileName}
      </Text>
    </Box>
  );
}

function SkillDetailPanel({
  skill,
  content,
}: {
  skill: SkillRecord;
  content: string;
}) {
  const theme = useTheme();
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const lines = body.split(/\r?\n/).slice(0, 20);
  return (
    <Panel color={theme.brand} border="double" title={`技能详情 · ${skill.name}`}>
      <Text color={theme.info}>
        #{skill.id} · {skill.name}
      </Text>
      <Text color={theme.text} wrap="wrap">
        {skill.description || '暂无描述'}
      </Text>
      <Text color={theme.muted} wrap="truncate">
        {skill.file}
      </Text>
      <Box borderStyle="single" borderColor={theme.border} paddingX={1} marginTop={1}>
        <Text color={theme.text} wrap="wrap">
          {lines.join('\n') || '（空）'}
        </Text>
        {body.split(/\r?\n/).length > lines.length ? (
          <Text color={theme.muted}>… 内容较长，仅显示前 {lines.length} 行</Text>
        ) : null}
      </Box>
      <Text color={theme.warning}>Esc</Text>
    </Panel>
  );
}

export function SkillsPanel({
  skills,
  selected,
  detail,
  detailContent,
}: {
  skills: SkillRecord[];
  selected: number;
  detail: SkillRecord | null;
  detailContent: string;
}) {
  const theme = useTheme();
  const { stdout } = useStdout();
  if (detail) return <SkillDetailPanel skill={detail} content={detailContent} />;
  const columns = stdout.columns || 80;
  const cardWidth = Math.max(28, Math.min(42, Math.floor((columns - 8) / 2)));
  return (
    <Panel color={theme.brand} border="double" title={`技能卡片 · ${skills.length}`}>
      <Text color={theme.muted}>↑↓ · Enter · Esc</Text>
      {skills.length === 0 ? (
        <Text color={theme.warning}>未找到技能。可在 .auraxis/skills、skills/ 或全局 ~/.auraxis/skills 创建 SKILL.md。</Text>
      ) : (
        <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
          {skills.map((skill, index) => (
            <SkillCard
              key={`${skill.file}:${skill.id}`}
              skill={skill}
              width={cardWidth}
              selected={index === selected}
            />
          ))}
        </Box>
      )}
    </Panel>
  );
}

export function ModelPickerPanel({
  models,
  selected,
  source,
}: {
  models: ModelChoice[];
  selected: number;
  source: 'live' | 'builtin';
}) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const sourceLabel = source === 'live' ? '实时模型' : '离线内置模型';
  const maxVisible = Math.max(4, Math.min(10, (stdout.rows || 24) - 8));
  const start = Math.max(
    0,
    Math.min(
      selected - Math.floor(maxVisible / 2),
      Math.max(0, models.length - maxVisible),
    ),
  );
  const visible = models.slice(start, start + maxVisible);
  return (
    <Panel color={theme.brand} border="double" title={`选择模型 · ${models.length}`}>
      <Text color={theme.muted}>{sourceLabel} · ↑↓ · Enter · Esc</Text>
      <Box flexDirection="column" marginTop={1}>
        {models.length === 0 ? (
          <Text color={theme.warning}>正在获取模型…</Text>
        ) : (
          <>
            {start > 0 ? <Text color={theme.muted}>… 上方还有 {start} 个模型</Text> : null}
            {visible.map((model, index) => {
              const actual = start + index;
              return (
                <Text
                  key={model.id}
                  color={actual === selected ? theme.text : theme.muted}
                  bold={actual === selected}
                  wrap="truncate"
                >
                  {actual === selected ? '▸' : ' '} {model.id}
                  {model.name && model.name !== model.id ? ` · ${model.name}` : ''}
                  {model.experimental ? ' · 实验' : ''}
                </Text>
              );
            })}
            {start + maxVisible < models.length ? (
              <Text color={theme.muted}>… 下方还有 {models.length - start - maxVisible} 个模型</Text>
            ) : null}
          </>
        )}
      </Box>
      <Text color={theme.warning}>Enter 切换 · Esc 取消</Text>
    </Panel>
  );
}

export function ChoicePickerPanel({ picker }: { picker: ChoicePickerState }) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const maxVisible = Math.max(4, Math.min(10, (stdout.rows || 24) - 8));
  const start = Math.max(
    0,
    Math.min(
      picker.selected - Math.floor(maxVisible / 2),
      Math.max(0, picker.options.length - maxVisible),
    ),
  );
  const visible = picker.options.slice(start, start + maxVisible);
  return (
    <Panel color={theme.brand} border="double" title={picker.title}>
      <Text color={theme.muted}>↑↓ · Enter · Esc</Text>
      <Box flexDirection="column" marginTop={1}>
        {start > 0 ? <Text color={theme.muted}>… 上方还有 {start} 项</Text> : null}
        {visible.map((option: ChoiceOption, index) => {
          const actual = start + index;
          return (
          <Text
            key={option.id}
            color={actual === picker.selected ? theme.text : theme.muted}
            bold={actual === picker.selected}
            wrap="truncate"
          >
            {actual === picker.selected ? '▸' : ' '} {option.label}
            {option.description ? ` · ${option.description}` : ''}
          </Text>
          );
        })}
        {start + maxVisible < picker.options.length ? (
          <Text color={theme.muted}>… 下方还有 {picker.options.length - start - maxVisible} 项</Text>
        ) : null}
      </Box>
      <Text color={theme.warning}>Enter 选择 · Esc 取消</Text>
    </Panel>
  );
}

export function PlanBlock({ plan }: { plan: Plan }) {
  const theme = useTheme();
  const approved = new Set(plan.approvedSteps || []);
  return (
    <Panel color={theme.plan} border="double" title={`计划 · ${plan.tasks.length} 项`}>
      {plan.tasks.map((task) => (
        <Text key={task.id} color={task.status === 'completed' ? theme.success : approved.has(task.id) ? theme.text : theme.muted} wrap="wrap">
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
      {request.preview ? (
        <DiffBlock text={request.preview} />
      ) : null}
      <Text color={theme.warning}>
        [y] [a] [r] [n]
      </Text>
    </Panel>
  );
}

export function AskBlock({ question }: { question: string }) {
  const theme = useTheme();
  return (
    <Panel color={theme.success} border="double" title="需要你回答">
      <Text color={theme.success}>{question}</Text>
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

const WIDE_TITLE_LINES = [
  ' █████╗ ██╗   ██╗██████╗  █████╗ ██╗  ██╗██╗███████╗     █████╗  ██████╗ ███████╗███╗   ██╗████████╗',
  '██╔══██╗██║   ██║██╔══██╗██╔══██╗╚██╗██╔╝██║██╔════╝    ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝',
  '███████║██║   ██║██████╔╝███████║ ╚███╔╝ ██║███████╗    ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ',
  '██╔══██║██║   ██║██╔══██╗██╔══██║ ██╔██╗ ██║╚════██║    ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ',
  '██║  ██║╚██████╔╝██║  ██║██║  ██║██╔╝ ██╗██║███████║    ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ',
  '╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚══════╝    ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ',
];
const WIDE_TITLE_SPLIT = 56;
const COMPACT_TITLE_LINES = buildBlockTitle('AURAXIS AGENT');
const COMPACT_TITLE_SPLIT = buildBlockTitle('AURAXIS')[0].length + 2;


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
      borderColor={selected ? theme.brandTo : theme.border}
      backgroundColor={selected ? theme.surfaceAlt : undefined}
      width={18}
      flexDirection="column"
      alignItems="flex-start"
      paddingX={1}
      paddingY={0}
      marginRight={1}
      flexGrow={0}
      flexShrink={0}
    >
      <Box flexDirection="column" width={14} alignItems="flex-start">
        <Box flexDirection="row" alignItems="center">
          <Text color={selected ? theme.text : theme.brandTo} bold={selected}>
            {icon}
          </Text>
          <Text color={selected ? theme.text : theme.muted} bold={selected} wrap="truncate">
            {' '}
            {label}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

const TOOL_ICONS: Record<string, string> = {
  Read: '▤',
  ReadImage: '◫',
  RunCode: '⌘',
  RunWorkflow: '⇄',
  Write: '✎',
  Edit: '✎',
  StrReplaceEditor: '⌨',
  Delete: '✕',
  NotebookEdit: '▤',
  Grep: '⌕',
  Glob: '▦',
  ListFiles: '☰',
  Bash: '❯',
  Pwsh: '⚡',
  WebFetch: '↗',
  WebSearch: '⊕',
  TodoWrite: '☑',
  AskUser: '?',
  InspectRuntime: '⌖',
  Agent: '⚑',
  SpawnAgents: '◈',
  MemoryRemember: '◆',
  MemorySearch: '⌖',
  PluginManage: '⌘',
  FindSymbol: '⌕',
  LspDefinition: '?',
  LspReferences: '↔',
  RemoteAgent: '☁',
  SendMessage: '✉',
  ReadMessages: '✉',
  PublishArtifact: '□',
  ListArtifacts: '▣',
  CreatePullRequest: '⎇',
  Undo: '↶',
  GitStatus: '⎇',
  GitDiff: '±',
  GitLog: '↺',
  GitCommit: '⬆',
  ListSkills: '≣',
  ReadSkill: '▤',
  ReviewArtifact: '✓',
  TaskOutput: '▣',
  TaskStop: '■',
  TaskList: '▤',
  JobList: '▤',
  JobOutput: '▣',
  JobKill: '■',
  Pty: '⌨',
  TerminalOpen: '⌨',
  TerminalList: '▤',
  TerminalRead: '▣',
  TerminalSend: '⌨',
  TerminalSignal: '■',
  TerminalClose: '✕',
};

export function toolIcon(name: string): string {
  return TOOL_ICONS[name] || '⚙';
}

export function CodeOutputBlock({ lines, running }: { lines: string[]; running: boolean }) {
  const theme = useTheme();
  const tail = lines.slice(-10);
  const hidden = lines.length - tail.length;
  return (
    <Box
      flexDirection="column"
      paddingX={1}
      marginTop={1}
      backgroundColor={theme.surfaceAlt}
    >
      <Box flexDirection="row" flexShrink={0}>
        <Text color={theme.info} bold>
          {'▸ '}
          {toolIcon('RunCode')} Code Mode
        </Text>
        {hidden > 0 ? (
          <Text color={theme.muted} dimColor wrap="truncate">
            {' '}
            · 前 {hidden} 行已折叠
          </Text>
        ) : null}
        <Box flexGrow={1} />
        {running ? (
          <Box marginRight={1}>
            <Spinner />
          </Box>
        ) : (
          <Text color={theme.success}>✓</Text>
        )}
      </Box>
      <Box flexDirection="column">
        {tail.map((line, index) => (
          <Box key={index} flexDirection="row" flexShrink={0}>
            <Text color={theme.border}>{CODE_OUTPUT_PREFIX}</Text>
            <Text color={theme.text} wrap="wrap">
              {truncateByWidth(line, 116)}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function CodeToolRow({
  name,
  status,
  ok,
  error,
  duration,
}: {
  name: string;
  status?: 'running' | 'done' | 'error' | 'aborted';
  ok?: boolean;
  error?: string;
  duration?: number;
}) {
  return (
    <ToolStatusRow
      name={name}
      status={status}
      ok={ok}
      error={error}
      duration={duration}
      compact
    />
  );
}

export function HomeCard({
  version,
  project,
  model,
  permission,
  reasoningEffort,
  homeFocus,
  selectedCommand,
}: {
  version: string;
  project: string;
  model: string;
  permission: string;
  reasoningEffort: string;
  homeFocus: 'input' | 'commands';
  selectedCommand: number;
}) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const terminalWidth = stdout.columns || 80;
  const useWideTitle = terminalWidth >= WIDE_TITLE_LINES[0].length + 10;
  const titleLines = useWideTitle ? WIDE_TITLE_LINES : COMPACT_TITLE_LINES;
  const titleSplit = useWideTitle ? WIDE_TITLE_SPLIT : COMPACT_TITLE_SPLIT;
  const contentWidth = useWideTitle
    ? Math.max(20, Math.min(112, terminalWidth) - 2)
    : Math.max(20, Math.min(88, terminalWidth) - 2);
  const pathLabel = shortenProjectPath(project, os.homedir(), 22);
  const permissionColor =
    permission === 'auto' ? theme.success : permission === 'plan' ? theme.plan : permission === 'ask' ? theme.warning : theme.info;

  const commandChips = HOME_COMMANDS.map((command, index) => (
    <CommandChip
      key={command.command}
      icon={command.icon}
      label={command.command}
      selected={homeFocus === 'commands' && selectedCommand === index}
    />
  ));

  return (
    <Box flexDirection="column" width={contentWidth}>
      <Panel color={theme.border} border="double" width={contentWidth} paddingY={0}>
        <Box flexDirection="column" width={contentWidth}>
          {titleLines.map((line) => (
            <Text key={line} color={theme.brandFrom} bold>
              {line.slice(0, titleSplit)}
              <Text color={theme.brandTo}>{line.slice(titleSplit)}</Text>
            </Text>
          ))}
          <Box marginTop={1}>
            <Text color={theme.text} bold>
              ❯_ Auraxis Agent CLI{' '}
              <Text color={theme.muted} dimColor>
                v{version}
              </Text>
            </Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            <Text wrap="truncate">
              <Text color={theme.muted}>模型 ：</Text>
              <Text color={theme.text}>{model}</Text>
              <Text color={theme.muted}>  模式 ：</Text>
              <Text color={permissionColor}>{permission}</Text>
              <Text color={theme.muted}>  思考 ：</Text>
              <Text color={theme.text}>{reasoningEffort}</Text>
            </Text>
            <Box marginTop={1}>
              <Text wrap="truncate">
                <Text color={theme.muted}>路径 ：</Text>
                <Text color={theme.text}>{pathLabel}</Text>
              </Text>
            </Box>
          </Box>
        </Box>
      </Panel>
      <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
        {commandChips}
      </Box>
    </Box>
  );
}
