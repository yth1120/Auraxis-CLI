import { useEffect, useState, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { PermissionRequest, Plan } from '@auraxis/core';

type BorderStyle = 'round' | 'single' | 'double';

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
  return (
    <Panel title="Auraxis Agent" color="cyan">
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
}: {
  model: string;
  mode: string;
  sandbox: string;
  deepThink: boolean;
  running: boolean;
  iterations: number;
  toolCalls: number;
  tokens: string;
}) {
  return (
    <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
      <Text dimColor>
        {model} · {mode} · {sandbox} · deepThink {deepThink ? 'on' : 'off'}
      </Text>
      <Text dimColor>
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
  return (
    <Panel color={running ? 'yellow' : 'green'} border="single">
      <Box flexDirection="row">
        <Text color={running ? 'yellow' : 'green'} bold>
          {running ? '●' : '❯'}
        </Text>
        <Text color={running ? 'yellow' : 'white'} wrap="wrap">
          {'  '}
          {input || (running ? '执行中 · Ctrl+C 取消' : '输入任务 · /help 查看命令')}
        </Text>
      </Box>
    </Panel>
  );
}

export function UserBlock({ text }: { text: string }) {
  return (
    <Panel color="green" border="single">
      <Text color="green" bold>
        ❯ 你
      </Text>
      <Text color="white" wrap="wrap">
        {text}
      </Text>
    </Panel>
  );
}

export function AssistantBlock({ text }: { text: string }) {
  return (
    <Box flexDirection="column">
      <Text dimColor>— Auraxis</Text>
      <Text color="white" wrap="wrap">
        {text}
      </Text>
    </Box>
  );
}

export function ThinkingBlock({ text, expanded }: { text: string; expanded: boolean }) {
  const preview = text.replace(/\s+/g, ' ').trim().slice(0, 90);
  return (
    <Panel color="yellow" border="single">
      <Text color="yellow" dimColor>
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
}: {
  name: string;
  summary: string;
  status?: 'running' | 'done' | 'error';
  ok?: boolean;
  error?: string;
  duration?: number;
}) {
  const color = status === 'error' || ok === false ? 'red' : status === 'done' ? 'green' : 'cyan';
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
    </Panel>
  );
}

export function PlanBlock({ plan }: { plan: Plan }) {
  const approved = new Set(plan.approvedSteps || []);
  return (
    <Panel color="blue" border="double" title={`计划 · ${plan.tasks.length} 项`}>
      {plan.tasks.map((task) => (
        <Text key={task.id} color={task.status === 'completed' ? 'green' : approved.has(task.id) ? 'white' : 'dim'} wrap="wrap">
          {task.status === 'completed' ? '✓' : task.status === 'running' ? '●' : task.status === 'blocked' ? '✗' : '○'} {task.id}. {task.description}
        </Text>
      ))}
    </Panel>
  );
}

export function PermissionBlock({ request }: { request: PermissionRequest }) {
  const color = request.danger === 'exec' ? 'red' : request.danger === 'write' ? 'yellow' : 'cyan';
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
      <Text color="yellow">
        [y]允许一次 · [a]允许本会话 · [r]允许当前规则 · [n]拒绝
      </Text>
    </Panel>
  );
}

export function AskBlock({ question }: { question: string }) {
  return (
    <Panel color="green" border="double" title="需要你回答">
      <Text color="green">{question}</Text>
      <Text dimColor>输入回答后按 Enter</Text>
    </Panel>
  );
}

export function ErrorBlock({ text }: { text: string }) {
  return (
    <Panel color="red" border="double" title="错误">
      <Text color="red">{text}</Text>
    </Panel>
  );
}

export function SystemBlock({ text }: { text: string }) {
  return (
    <Panel color="magenta" border="single">
      <Text color="magenta" dimColor>
        ℹ {text}
      </Text>
    </Panel>
  );
}

