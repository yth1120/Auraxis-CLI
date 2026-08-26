import { useCallback, useEffect, useRef, useState } from 'react';
import { execFile } from 'node:child_process';
import { Box, Text, render, useApp, useInput, useStdin } from 'ink';
import path from 'node:path';
import {
  getAppPaths,
  getTools,
  chatMessageText,
  loadRuntimeConfig,
  loadMcpServers,
  McpManager,
  scanSkills,
  runAgent,
  SecretStore,
  SessionStore,
  summarizeToolInput,
  type AgentEvent,
  type ChatMessage,
  type PermissionRequest,
  type Plan,
  type SessionRecord,
} from '@auraxis/core';
import type { CliOptions } from '../args.js';
import {
  HeaderBar,
  StatusBar,
  PromptBar,
  UserBlock,
  AssistantBlock,
  ThinkingBlock,
  ToolBlock,
  PlanBlock,
  PermissionBlock,
  AskBlock,
  ErrorBlock,
  SystemBlock,
  ThemeProvider,
  type ThemeName,
  HomeCard,
} from './blocks.js';

interface UiItem {
  kind: 'user' | 'assistant' | 'thinking' | 'tool' | 'error' | 'system' | 'plan';
  text: string;
  toolName?: string;
  ok?: boolean;
  status?: 'running' | 'done' | 'error';
  duration?: number;
  error?: string;
  output?: string;
  plan?: Plan;
}

type PromptState =
  | { kind: 'permission'; request: PermissionRequest; resolve: (value: 'allow_once' | 'allow_session' | 'allow_rule' | 'deny') => void }
  | { kind: 'plan'; plan: Plan; resolve: (value: 'approve' | 'reject' | 'edit') => void }
  | { kind: 'ask'; question: string; resolve: (value: string) => void }
  | null;

interface Stats {
  iterations: number;
  toolCalls: number;
  tokens: string;
}

function formatPlan(plan: Plan): string {
  return plan.tasks.map((task) => `  ${task.id}. ${task.description} [${task.status}]`).join('\n');
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
  const [theme, setTheme] = useState<ThemeName>('dark');
  const [showHome, setShowHome] = useState(true);
  const [branch, setBranch] = useState('main');
  const [homeFocus, setHomeFocus] = useState<'input' | 'commands'>('input');
  const [selectedCommand, setSelectedCommand] = useState(0);
  const homeCommands = [
    { icon: '▣', command: '/chat' },
    { icon: '◇', command: '/init' },
    { icon: '▸', command: '/run <file>' },
    { icon: '☰', command: '/config' },
    { icon: '?', command: '/help' },
  ];
  const [expandedThinking, setExpandedThinking] = useState(false);
  const [stats, setStats] = useState<Stats>({ iterations: 0, toolCalls: 0, tokens: '0 in / 0 out' });
  const [elapsed, setElapsed] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const promptRef = useRef<PromptState>(null);
  const sessionRef = useRef<SessionRecord | null>(null);
  const mcpRef = useRef<McpManager | null>(null);
  const startedAtRef = useRef(0);
  const VISIBLE_ENTRIES = 12;

  useEffect(() => {
    const root = options.project ? path.resolve(options.project) : process.cwd();
    execFile('git', ['branch', '--show-current'], { cwd: root }, (error, stdout) => {
      setBranch(!error && stdout.trim() ? stdout.trim() : 'main');
    });
  }, [options.project]);

  useEffect(() => {
    setScrollOffset(0);
  }, [entries.length]);

  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 500);
    return () => clearInterval(timer);
  }, [running]);

  const projectLabel = path.basename(options.project || process.cwd()) || '当前项目';
  const projectFull = options.project ? path.resolve(options.project) : process.cwd();

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

  const appendTool = useCallback(
    (name: string, summary: string, ok?: boolean, duration?: number, error?: string, preview?: string) => {
      setEntries((prev) => {
        const last = prev[prev.length - 1];
        if (last?.kind === 'tool' && last.toolName === name) {
          return [
            ...prev.slice(0, -1),
            {
              ...last,
              text: summary || last.text,
              ok: ok ?? last.ok,
              status: ok === undefined ? 'running' : ok ? 'done' : 'error',
              duration: duration ?? last.duration,
              error: error ?? last.error,
              output: preview ?? last.output,
            },
          ];
        }
        return [
          ...prev,
          {
            kind: 'tool',
            toolName: name,
            text: summary,
            ok,
            status: ok === undefined ? 'running' : ok ? 'done' : 'error',
            duration,
            error,
            output: preview,
          },
        ];
      });
    },
    [],
  );

  const saveSession = useCallback(async (session: SessionRecord, messages: ChatMessage[], text: string) => {
    const store = new SessionStore({ dir: getAppPaths().sessionsDir });
    session.messages = messages;
    session.summary = text.slice(0, 500);
    await store.save(session);
  }, []);

  const handleEvent = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
        case 'text_chunk':
          appendAssistant(event.text);
          break;
        case 'thinking_chunk':
          appendThinking(event.chunk, event.isNewBlock);
          break;
        case 'iteration_start':
          setStats((prev) => ({ ...prev, iterations: event.iteration }));
          break;
        case 'tool_start':
          setStats((prev) => ({ ...prev, toolCalls: prev.toolCalls + 1 }));
          appendTool(event.toolName, summarizeToolInput(event.toolName, event.input), undefined);
          break;
        case 'tool_end':
          appendTool(event.toolName, `${event.toolName} · ${event.durationMs}ms`, true, event.durationMs, undefined, event.outputPreview);
          break;
        case 'tool_error':
          appendTool(event.toolName, `${event.toolName} 失败`, false, undefined, event.error);
          break;
        case 'plan_created':
          addItem({ kind: 'plan', text: formatPlan(event.plan), plan: event.plan });
          break;
        case 'plan_updated':
          addItem({ kind: 'plan', text: formatPlan(event.plan), plan: event.plan });
          break;
        case 'system_message':
          addItem({ kind: 'system', text: event.content });
          break;
        case 'usage':
          setStats((prev) => ({
            ...prev,
            tokens: `${event.inputTokens} in / ${event.outputTokens} out`,
          }));
          break;
        case 'error':
          addItem({ kind: 'error', text: event.error });
          break;
        default:
          break;
      }
    },
    [addItem, appendAssistant, appendThinking, appendTool],
  );

  const runPrompt = useCallback(
    async (promptText: string) => {
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
      let mcpManager = mcpRef.current;
      if (!mcpManager) {
        mcpManager = new McpManager(await loadMcpServers(config.projectRoot));
        await mcpManager.start();
        mcpRef.current = mcpManager;
        for (const error of mcpManager.errors) {
          addItem({ kind: 'system', text: `[MCP] ${error}` });
        }
      }
      const tools = [...getTools(), ...mcpManager.getToolDefinitions()];
      let session = sessionRef.current;
      if (!session) {
        session = options.session ? await store.load(options.session) : null;
        if (!session) session = await store.create(config.projectRoot, config.model);
        sessionRef.current = session;
      }
      const resumeMessages = session.messages || [];
      const controller = new AbortController();
      controllerRef.current = controller;
      startedAtRef.current = Date.now();
      setStats({ iterations: 0, toolCalls: 0, tokens: '0 in / 0 out' });
      setExpandedThinking(false);
      setShowHome(false);
      setHomeFocus('input');
      setSelectedCommand(0);
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
        tools,
        mcp: mcpManager,
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
    },
    [addItem, appendAssistant, handleEvent, model, mode, options, sandbox, saveSession, deepThink],
  );

  const submit = useCallback((valueOverride?: string) => {
    const value = (valueOverride ?? input).trim();
    if (!value) return;
    setHistory((prev) => (prev[prev.length - 1] === value ? prev : [...prev, value].slice(-100)));
    setHistoryIndex(null);
    if (value.startsWith('/')) {
      const [command, ...rest] = value.slice(1).split(/\s+/);
      const body = rest.join(' ');
      if (command === 'help') {
        addItem({
          kind: 'system',
          text: '/home /help /clear /quit /status /model <id> /mode <ask|plan|auto> /sandbox <mode> /deep-think <on|off> /theme <dark|light|neon|mono> /api-key <key> /chat /run <file> /init /config /tools /skills /mcp /doctor /sessions /history\nPgUp/PgDn 浏览历史 · Ctrl+T 展开思考 · Ctrl+C 取消',
        });
      } else if (command === 'clear') {
        setEntries([]);
      } else if (command === 'quit' || command === 'exit') {
        void mcpRef.current?.close();
        exit();
      } else if (command === 'status') {
        addItem({ kind: 'system', text: `model=${model} mode=${mode} sandbox=${sandbox} deepThink=${deepThink}` });
      } else if (command === 'tools') {
        addItem({ kind: 'system', text: getTools().map((tool) => `${tool.name} [${tool.danger}]`).join('\n') });
      } else if (command === 'history') {
        addItem({ kind: 'system', text: history.length ? history.slice(-20).join('\n') : '暂无历史命令' });
      } else if (command === 'mcp') {
        const manager = mcpRef.current;
        const tools = manager?.getToolDefinitions() || [];
        addItem({
          kind: 'system',
          text: tools.length
            ? tools.map((tool) => `${tool.name} · ${tool.mcpServer || 'MCP'}`).join('\n')
            : '尚未连接 MCP 服务',
        });
      } else if (command === 'skills') {
        void (async () => {
          const skills = await scanSkills(options.project ? path.resolve(options.project) : process.cwd());
          addItem({
            kind: 'system',
            text: skills.length
              ? skills.map((skill) => `${skill.id} · ${skill.name}${skill.description ? ` — ${skill.description}` : ''}`).join('\n')
              : '暂无技能',
          });
        })();
      } else if (command === 'doctor') {
        void (async () => {
          const manager = mcpRef.current;
          const skills = await scanSkills(options.project ? path.resolve(options.project) : process.cwd());
          addItem({
            kind: 'system',
            text: `模型: ${model}\n模式: ${mode}\n沙箱: ${sandbox}\n工具: ${getTools().length + (manager?.getToolDefinitions().length || 0)}\n技能: ${skills.length}\nMCP: ${manager?.getToolDefinitions().length || 0}`,
          });
        })();
      } else if (command === 'sessions') {
        void (async () => {
          const store = new SessionStore({ dir: getAppPaths().sessionsDir });
          const sessions = await store.list(options.project ? path.resolve(options.project) : undefined);
          addItem({
            kind: 'system',
            text: sessions.length
              ? sessions
                  .map(
                    (session) =>
                      `${session.id} · ${new Date(session.updatedAt).toLocaleString()} · ${chatMessageText(session.messages.find((message) => message.role === 'user')?.content).slice(0, 60) || '(空)'}`,
                  )
                  .join('\n')
              : '暂无会话',
          });
        })();
      } else if (command === 'session' && body) {
        void (async () => {
          const store = new SessionStore({ dir: getAppPaths().sessionsDir });
          const session = await store.load(body);
          if (!session) {
            addItem({ kind: 'error', text: `找不到会话 ${body}` });
            return;
          }
          sessionRef.current = session;
          setModel(session.model);
          addItem({ kind: 'system', text: `已恢复会话 ${session.id} · ${session.messages.length} 条消息` });
        })();
      } else if (command === 'delete' && body) {
        void (async () => {
          const store = new SessionStore({ dir: getAppPaths().sessionsDir });
          await store.remove(body);
          addItem({ kind: 'system', text: `已删除会话 ${body}` });
        })();
      } else if (command === 'chat') {
        void runPrompt(body || '请开始对话');
      } else if (command === 'run' && body) {
        void runPrompt(`请运行文件 ${body}，并只给出结果摘要。`);
      } else if (command === 'init') {
        addItem({ kind: 'system', text: '初始化项目：已读取项目目录；可在 .auraxis 中配置指令、MCP 与技能。' });
      } else if (command === 'config') {
        addItem({ kind: 'system', text: `model=${model} mode=${mode} sandbox=${sandbox} theme=${theme}` });
      } else if (command === 'model' && body) {
        setModel(body);
      } else if (command === 'mode' && ['ask', 'plan', 'auto'].includes(body)) {
        setMode(body);
      } else if (command === 'sandbox' && ['read', 'workspace-write', 'full'].includes(body)) {
        setSandbox(body);
      } else if (command === 'deep-think' && ['on', 'off'].includes(body)) {
        setDeepThink(body === 'on');
      } else if (command === 'api-key' && body) {
        void (async () => {
          const paths = getAppPaths();
          const store = new SecretStore(paths.credentialsFile, paths.keyFile);
          await store.set('DEEPSEEK_API_KEY', body);
          addItem({ kind: 'system', text: 'API Key 已加密保存' });
        })();
      } else if (command === 'theme' && ['dark', 'light', 'neon', 'mono'].includes(body)) {
        setTheme(body as ThemeName);
        addItem({ kind: 'system', text: `主题已切换为 ${body}` });
      } else if (command === 'home') {
        setShowHome(true);
        setHomeFocus('input');
        setSelectedCommand(0);
        addItem({ kind: 'system', text: '已返回启动主页' });
      } else {
        addItem({ kind: 'system', text: `未知命令 ${command}` });
      }
      setInput('');
      return;
    }
    void runPrompt(value);
  }, [addItem, exit, history, input, model, mode, options.project, sandbox, deepThink, runPrompt]);

  useInput((keyInput, key) => {
    const activePrompt = promptRef.current;
    if (activePrompt) {
      if (activePrompt.kind === 'permission') {
        const decision =
          keyInput === 'y' || keyInput === 'Y'
            ? 'allow_once'
            : keyInput === 'a' || keyInput === 'A'
              ? 'allow_session'
              : keyInput === 'r' || keyInput === 'R'
                ? 'allow_rule'
                : keyInput === 'n' || keyInput === 'N' || key.escape
                  ? 'deny'
                  : undefined;
        if (decision) {
          activePrompt.resolve(decision);
          setActivePrompt(null);
        }
        return;
      }
      if (activePrompt.kind === 'plan') {
        const decision =
          keyInput === 'a' || keyInput === 'A'
            ? 'approve'
            : keyInput === 'r' || keyInput === 'R'
              ? 'reject'
              : keyInput === 'e' || keyInput === 'E'
                ? 'edit'
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

    if (showHome) {
      if (key.tab) {
        setHomeFocus((current) => (current === 'input' ? 'commands' : 'input'));
        return;
      }
      if (homeFocus === 'commands') {
        if (key.leftArrow) {
          setSelectedCommand((current) => (current - 1 + homeCommands.length) % homeCommands.length);
          return;
        }
        if (key.rightArrow) {
          setSelectedCommand((current) => (current + 1) % homeCommands.length);
          return;
        }
        const digit = Number(keyInput);
        if (Number.isInteger(digit) && digit >= 1 && digit <= homeCommands.length) {
          setSelectedCommand(digit - 1);
          submit(homeCommands[digit - 1].command);
          return;
        }
        if (key.return) {
          submit(homeCommands[selectedCommand].command);
          return;
        }
        if (key.escape) {
          setHomeFocus('input');
          return;
        }
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
    if (key.ctrl && keyInput === 't') {
      setExpandedThinking((current) => !current);
      return;
    }
    if (!running && key.pageUp) {
      setScrollOffset((current) => Math.min(current + 4, Math.max(0, entries.length - VISIBLE_ENTRIES)));
      return;
    }
    if (!running && key.pageDown) {
      setScrollOffset((current) => Math.max(0, current - 4));
      return;
    }
    if (!running && key.upArrow && history.length) {
      const nextIndex = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInput(history[nextIndex]);
      return;
    }
    if (!running && key.downArrow && historyIndex !== null) {
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(null);
        setInput('');
      } else {
        setHistoryIndex(nextIndex);
        setInput(history[nextIndex]);
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

  const visibleEntries = entries.slice(
    Math.max(0, entries.length - VISIBLE_ENTRIES - scrollOffset),
    Math.max(0, entries.length - scrollOffset),
  );

  return (
    <ThemeProvider theme={theme}>
      <Box flexDirection="column" paddingX={1}>
        {showHome ? (
          <HomeCard
            project={projectFull}
            branch={branch}
            model={model}
            mode={mode}
            sandbox={sandbox}
            version="0.1.0"
            running={running}
            input={input}
            homeFocus={homeFocus}
            selectedCommand={selectedCommand}
          />
        ) : (
          <HeaderBar project={projectLabel} running={running} />
        )}
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
        {scrollOffset > 0 && visibleEntries.length < entries.length ? (
          <Text dimColor>↑ PgUp / PgDn 浏览历史 · 当前位于最早可见位置</Text>
        ) : null}
        {visibleEntries.map((item, index) => {
          switch (item.kind) {
            case 'user':
              return <UserBlock key={index} text={item.text} />;
            case 'assistant':
              return <AssistantBlock key={index} text={item.text} />;
            case 'thinking':
              return <ThinkingBlock key={index} text={item.text} expanded={expandedThinking} />;
            case 'tool':
              return (
                <ToolBlock
                  key={index}
                  name={item.toolName || 'Tool'}
                  summary={item.text}
                  status={item.status}
                  ok={item.ok}
                  error={item.error}
                  duration={item.duration}
                  output={item.output}
                />
              );
            case 'plan':
              return <PlanBlock key={index} plan={item.plan || { tasks: [], summary: item.text }} />;
            case 'error':
              return <ErrorBlock key={index} text={item.text} />;
            case 'system':
              return <SystemBlock key={index} text={item.text} />;
            default:
              return null;
          }
        })}
        </Box>
        {!showHome ? <PromptBar input={input} running={running} /> : null}
        {prompt?.kind === 'permission' ? <PermissionBlock request={prompt.request} /> : null}
        {prompt?.kind === 'plan' ? (
          <>
            <PlanBlock plan={prompt.plan} />
            <Text color="blue">[a]批准全部 · [r]拒绝 · [e]编辑（将在后续版本开放）</Text>
          </>
        ) : null}
        {prompt?.kind === 'ask' ? <AskBlock question={prompt.question} /> : null}
        {exitArmed ? <Text color="yellow">按 Ctrl+C 确认退出</Text> : null}
        {!showHome ? (
          <StatusBar
            model={model}
            mode={mode}
            sandbox={sandbox}
            deepThink={deepThink}
            running={running}
            iterations={stats.iterations}
            toolCalls={stats.toolCalls}
            tokens={`${elapsed}s · ${stats.tokens}`}
            themeName={theme}
          />
        ) : null}
      </Box>
    </ThemeProvider>
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
