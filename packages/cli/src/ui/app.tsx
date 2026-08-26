import React, { useCallback, useRef, useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdin } from 'ink';
import {
  getAppPaths,
  getTools,
  loadRuntimeConfig,
  runAgent,
  SecretStore,
  SessionStore,
  type AgentEvent,
  type ChatMessage,
  type PermissionRequest,
  type Plan,
  type SessionRecord,
} from '@auraxis/core';
import type { CliOptions } from '../args.js';

interface UiItem {
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'error' | 'system' | 'plan';
  text: string;
  toolName?: string;
  ok?: boolean;
}

type PromptState =
  | { kind: 'permission'; request: PermissionRequest; resolve: (value: 'allow_once' | 'allow_session' | 'allow_rule' | 'deny') => void }
  | { kind: 'plan'; plan: Plan; resolve: (value: 'approve' | 'reject' | 'edit') => void }
  | { kind: 'ask'; question: string; resolve: (value: string) => void }
  | null;

function formatPlan(plan: Plan): string {
  const lines = plan.tasks.map((task) => `  ${task.id}. ${task.description} [${task.status}]`);
  return `${plan.summary ? `${plan.summary}\n` : ''}计划 ${plan.tasks.length} 项:\n${lines.join('\n')}`;
}

function App({ options }: { options: CliOptions }) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const [entries, setEntries] = useState<UiItem[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [exitArmed, setExitArmed] = useState(false);
  const [prompt, setPrompt] = useState<PromptState>(null);
  const [model, setModel] = useState(options.model || 'deepseek-v4-pro');
  const [mode, setMode] = useState<string>(options.mode || 'ask');
  const [sandbox, setSandbox] = useState<string>(options.sandbox || 'workspace-write');
  const [deepThink, setDeepThink] = useState(Boolean(options.deepThink));
  const controllerRef = useRef<AbortController | null>(null);
  const promptRef = useRef<PromptState>(null);
  const sessionRef = useRef<SessionRecord | null>(null);

  const setActivePrompt = (next: PromptState) => {
    promptRef.current = next;
    setPrompt(next);
  };

  const addItem = useCallback((item: UiItem) => {
    setEntries((prev) => [...prev, item]);
  }, []);

  const appendAssistant = useCallback((text: string) => {
    setEntries((prev) => {
      const last = prev[prev.length - 1];
      if (last?.kind === 'assistant') {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...prev, { kind: 'assistant', text }];
    });
  }, []);

  const appendThinking = useCallback((text: string, isNewBlock?: boolean) => {
    if (!text && !isNewBlock) return;
    setEntries((prev) => {
      const last = prev[prev.length - 1];
      if (last?.kind === 'thinking' && !isNewBlock) {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...prev, { kind: 'thinking', text }];
    });
  }, []);

  const appendTool = useCallback((name: string, text: string, ok?: boolean) => {
    setEntries((prev) => {
      const last = prev[prev.length - 1];
      if (last?.kind === 'tool' && last.toolName === name) {
        return [...prev.slice(0, -1), { ...last, text: `${last.text} ${text}`.trim(), ok: ok ?? last.ok }];
      }
      return [...prev, { kind: 'tool', toolName: name, text, ok }];
    });
  }, []);

  const saveSession = useCallback(async (session: SessionRecord, messages: ChatMessage[], text: string) => {
    const store = new SessionStore({ dir: getAppPaths().sessionsDir });
    session.messages = messages;
    session.summary = text.slice(0, 500);
    await store.save(session);
  }, []);

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'text_chunk':
        appendAssistant(event.text);
        break;
      case 'thinking_chunk':
        appendThinking(event.chunk, event.isNewBlock);
        break;
      case 'tool_start':
        appendTool(event.toolName, `[工具] ${event.toolName}`, undefined);
        break;
      case 'tool_end':
        appendTool(event.toolName, `[完成] ${event.toolName} (${event.durationMs}ms)`, true);
        break;
      case 'tool_error':
        appendTool(event.toolName, `[失败] ${event.toolName}: ${event.error}`, false);
        break;
      case 'plan_created':
        addItem({ kind: 'plan', text: formatPlan(event.plan) });
        break;
      case 'plan_updated':
        addItem({ kind: 'plan', text: formatPlan(event.plan) });
        break;
      case 'system_message':
        addItem({ kind: 'system', text: event.content });
        break;
      case 'error':
        addItem({ kind: 'error', text: event.error });
        break;
      default:
        break;
    }
  }, [addItem, appendAssistant, appendThinking, appendTool]);

  const runPrompt = useCallback(async (promptText: string) => {
    const config = await loadRuntimeConfig({
      project: options.project,
      model,
      apiKey: options.apiKey,
      apiBase: options.apiBase,
      mode,
      sandbox,
      deepThink,
      maxIterations: options.maxIterations,
    });
    const paths = getAppPaths();
    const secret = new SecretStore(paths.credentialsFile, paths.keyFile);
    const apiKey = config.apiKey || (await secret.get('DEEPSEEK_API_KEY').catch(() => undefined)) || '';
    if (!apiKey) {
      addItem({ kind: 'error', text: '未配置 DeepSeek API Key，请设置 DEEPSEEK_API_KEY 后重试。' });
      return;
    }
    const store = new SessionStore({ dir: paths.sessionsDir });
    let session = sessionRef.current;
    if (!session) {
      session = options.session ? await store.load(options.session) : null;
      if (!session) session = await store.create(config.projectRoot, config.model);
      sessionRef.current = session;
    }
    const resumeMessages = session.messages || [];
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    addItem({ kind: 'user', text: promptText });

    const requestPermission = async (request: PermissionRequest) => {
      return new Promise<'allow_once' | 'allow_session' | 'allow_rule' | 'deny'>((resolve) => {
        setActivePrompt({ kind: 'permission', request, resolve });
      });
    };
    const onPlanApproval = async (plan: Plan) => {
      return new Promise<'approve' | 'reject' | 'edit'>((resolve) => {
        setActivePrompt({ kind: 'plan', plan, resolve });
      });
    };
    const askUser = async (question: string) => {
      return new Promise<string>((resolve) => {
        setActivePrompt({ kind: 'ask', question, resolve });
      });
    };

    const result = await runAgent({
      prompt: promptText,
      projectRoot: config.projectRoot,
      model: config.model,
      apiKey,
      apiBase: config.apiBase,
      mode: config.mode,
      sandboxMode: config.sandboxMode,
      maxIterations: config.maxIterations,
      deepThink: config.deepThink,
      reasoningEffort: config.reasoningEffort,
      toolChoice: config.toolChoice,
      tools: getTools(),
      sessionId: session.id,
      resumeMessages,
      signal: controller.signal,
      onEvent: handleEvent,
      requestPermission,
      onPlanApproval,
      askUser,
    });
    await saveSession(session, result.messages, result.text);
    if (result.aborted) addItem({ kind: 'system', text: '任务已取消' });
    setRunning(false);
    controllerRef.current = null;
    setInput('');
  }, [addItem, appendAssistant, handleEvent, model, mode, options, sandbox, saveSession, deepThink]);

  const submit = useCallback(() => {
    const value = input.trim();
    if (!value) return;
    if (value.startsWith('/')) {
      const [command, ...rest] = value.slice(1).split(/\s+/);
      const body = rest.join(' ');
      if (command === 'help') {
        addItem({ kind: 'system', text: '/help /clear /quit /status /model <id> /mode <ask|plan|auto> /sandbox <mode> /deep-think <on|off>' });
      } else if (command === 'clear') {
        setEntries([]);
      } else if (command === 'quit' || command === 'exit') {
        exit();
      } else if (command === 'status') {
        addItem({ kind: 'system', text: `model=${model} mode=${mode} sandbox=${sandbox} deepThink=${deepThink}` });
      } else if (command === 'model' && body) {
        setModel(body);
      } else if (command === 'mode' && ['ask', 'plan', 'auto'].includes(body)) {
        setMode(body);
      } else if (command === 'sandbox' && ['read', 'workspace-write', 'full'].includes(body)) {
        setSandbox(body);
      } else if (command === 'deep-think' && ['on', 'off'].includes(body)) {
        setDeepThink(body === 'on');
      } else {
        addItem({ kind: 'system', text: `未知命令 ${command}` });
      }
      setInput('');
      return;
    }
    void runPrompt(value);
  }, [addItem, exit, input, model, mode, sandbox, deepThink, runPrompt]);

  useInput((keyInput, key) => {
    const activePrompt = promptRef.current;
    if (activePrompt) {
      if (activePrompt.kind === 'permission') {
        const decision = keyInput === 'y' || keyInput === 'Y' ? 'allow_once'
          : keyInput === 'a' || keyInput === 'A' ? 'allow_session'
            : keyInput === 'r' || keyInput === 'R' ? 'allow_rule'
              : keyInput === 'n' || keyInput === 'N' || key.escape ? 'deny'
                : undefined;
        if (decision) {
          activePrompt.resolve(decision);
          setActivePrompt(null);
        }
        return;
      }
      if (activePrompt.kind === 'plan') {
        const decision = keyInput === 'a' || keyInput === 'A' ? 'approve'
          : keyInput === 'r' || keyInput === 'R' ? 'reject'
            : keyInput === 'e' || keyInput === 'E' ? 'edit'
              : undefined;
        if (decision) {
          activePrompt.resolve(decision);
          setActivePrompt(null);
        }
        return;
      }
      if (activePrompt.kind === 'ask') {
        if (key.return) {
          activePrompt.resolve(input);
          setActivePrompt(null);
          setInput('');
        } else if (key.backspace) {
          setInput((prev) => prev.slice(0, -1));
        } else if (!key.ctrl && !key.meta && keyInput) {
          setInput((prev) => prev + keyInput);
        }
        return;
      }
    }

    if (key.ctrl && keyInput === 'c') {
      if (running) {
        controllerRef.current?.abort();
      } else if (exitArmed) {
        exit();
      } else {
        setExitArmed(true);
        setTimeout(() => setExitArmed(false), 2000);
      }
      return;
    }
    if (key.return) {
      submit();
      return;
    }
    if (running) return;
    if (key.backspace) {
      setInput((prev) => prev.slice(0, -1));
    } else if (key.ctrl && keyInput === 'j') {
      setInput((prev) => `${prev}\n`);
    } else if (!key.ctrl && !key.meta && keyInput && keyInput !== '\r' && keyInput !== '\n') {
      setInput((prev) => prev + keyInput);
    }
  });

  if (!isRawModeSupported) {
    return <Text color="yellow">当前终端不支持交互模式，请运行 auraxis --run "任务"。</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>Auraxis CLI</Text>
      <Text dimColor>model={model} mode={mode} sandbox={sandbox} deepThink={deepThink ? 'on' : 'off'} {running ? '· running' : ''}</Text>
      <Box flexDirection="column" marginTop={1}>
        {entries.map((item, index) => {
          switch (item.kind) {
            case 'user':
              return <Text key={index} color="green">❯ {item.text}</Text>;
            case 'assistant':
              return <Text key={index} color="white">{item.text}</Text>;
            case 'thinking':
              return <Text key={index} color="yellow" dimColor>✦ {item.text}</Text>;
            case 'tool':
              return <Text key={index} color={item.ok === false ? 'red' : 'cyan'} dimColor>{item.text}</Text>;
            case 'error':
              return <Text key={index} color="red">✗ {item.text}</Text>;
            case 'system':
              return <Text key={index} color="magenta">ℹ {item.text}</Text>;
            case 'plan':
              return <Text key={index} color="blue">{item.text}</Text>;
            default:
              return null;
          }
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={running ? 'yellow' : 'green'}>{running ? '● ' : '❯ '}</Text>
        <Text>{input || (running ? '执行中，Ctrl+C 取消' : '输入任务，/help 查看命令')}</Text>
      </Box>
      {prompt?.kind === 'permission' && (
        <Box borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
          <Text>
            {prompt.request.tool} · {prompt.request.summary}{'\n'}
            <Text color="yellow">[y]允许一次 [a]允许本会话 [r]允许规则 [n]拒绝</Text>
          </Text>
        </Box>
      )}
      {prompt?.kind === 'plan' && (
        <Box borderStyle="round" borderColor="blue" paddingX={1} marginTop={1}>
          <Text>
            {formatPlan(prompt.plan)}{'\n'}
            <Text color="blue">[a]批准 [r]拒绝 [e]编辑</Text>
          </Text>
        </Box>
      )}
      {prompt?.kind === 'ask' && (
        <Box borderStyle="round" borderColor="green" paddingX={1} marginTop={1}>
          <Text>{prompt.question}{'\n'}回答后按 Enter</Text>
        </Box>
      )}
      {exitArmed && <Text color="yellow">再按 Ctrl+C 退出</Text>}
    </Box>
  );
}

export async function runInteractive(options: CliOptions): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('交互模式需要 TTY。请直接在终端运行 auraxis，或使用 --run 执行任务。');
    return 1;
  }
  const app = render(<App options={options} />);
  await app.waitUntilExit();
  return 0;
}
