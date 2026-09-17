import { useCallback, useEffect, useRef, useState } from 'react';
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import { useApp, useInput, useStdin } from 'ink';
import path from 'node:path';
import {
  getAppPaths,
  getTools,
  getTool,
  BUILT_IN_MODELS,
  DeepSeekClient,
  DeepSeekFilesClient,
  chatMessageText,
  safeProcessEnv,
  loadHooks,
  loadRuntimeConfig,
  loadMcpServers,
  McpManager,
  runHooksFor,
  scanSkills,
  runAgent,
  runCodeProgram,
  scanPlugins,
  installPlugin,
  discoverMarketplace,
  readSkillContent,
  createWorktree,
  listWorktrees,
  removeWorktree,
  createCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
  findSymbols,
  SecretStore,
  SessionStore,
  MemoryStore,
  saveRuntimeConfig,
  SandboxPolicy,
  SessionMailbox,
  LspManager,
  AuditStore,
  asJsonObject,
  parseJson,
  resolveModelChoices,
  summarizeToolInput,
  UndoStore,
  type AgentEvent,
  type ApiFamily,
  type ChatMessage,
  type CodeModeEvent,
  type CodeModeExecuteResult,
  type CodeModeSubCall,
  type ImageDetail,
  type ModelProvider,
  type PermissionRequest,
  type Plan,
  type ReasoningEffort,
  type SessionRecord,
  type SkillRecord,
  type ToolContext,
  type ToolChoice,
} from '@auraxis/core';
import { apiKeyEnvName, type CliOptions } from '../args.js';
import type { ThemeName } from './blocks.js';
import { matchCommandHints, resolveCommandAlias, resolveSuggestedCommand, type CommandHint } from './commands.js';
import { HOME_COMMANDS, formatSessionTime } from './home.js';
import {
  appendPendingPrompt,
  formatPlan,
  mouseScrollDelta,
  sessionToUiItems,
  takeNextPendingPrompt,
  withdrawPendingPrompt as popPendingPrompt,
  type ActiveCommand,
  type ActivityItem,
  type ChoiceOption,
  type ChoicePickerKind,
  type ChoicePickerState,
  type ModelPickerState,
  type PromptState,
  type Stats,
  type TerminalController,
  type UiItem,
} from './terminal-model.js';

const PERMISSION_OPTIONS: ChoiceOption[] = [
  { id: 'ask', label: 'ask', description: '每次操作前询问' },
  { id: 'plan', label: 'plan', description: '先制定计划再执行' },
  { id: 'auto', label: 'auto', description: '自动批准工具调用' },
];

const REASONING_OPTIONS: ChoiceOption[] = [
  { id: 'low', label: 'low', description: '快速、省 token' },
  { id: 'high', label: 'high', description: '均衡（推荐）' },
  { id: 'max', label: 'max', description: '深度推理' },
];

const SANDBOX_OPTIONS: ChoiceOption[] = [
  { id: 'read', label: 'read', description: '只读，禁止写入与执行' },
  { id: 'workspace-write', label: 'workspace-write', description: '允许项目内修改' },
  { id: 'full', label: 'full', description: '完全访问' },
  { id: 'container', label: 'container', description: '容器隔离执行' },
];

const PROVIDER_OPTIONS: ChoiceOption[] = [
  { id: 'deepseek', label: 'deepseek', description: 'DeepSeek' },
  { id: 'openai', label: 'openai', description: 'OpenAI 兼容接口' },
  { id: 'anthropic', label: 'anthropic', description: 'Anthropic 兼容接口' },
  { id: 'gemini', label: 'gemini', description: 'Gemini' },
  { id: 'ollama', label: 'ollama', description: '本地 Ollama' },
  { id: 'custom', label: 'custom', description: '自定义 API' },
];

const API_FAMILY_OPTIONS: ChoiceOption[] = [
  { id: 'chat', label: 'chat', description: 'OpenAI 兼容 Chat Completions' },
  { id: 'responses', label: 'responses', description: 'DeepSeek 原生 Responses API' },
  { id: 'anthropic', label: 'anthropic', description: 'DeepSeek Anthropic 兼容端点' },
];

const VISION_DETAIL_OPTIONS: ChoiceOption[] = [
  { id: 'auto', label: 'auto', description: '自动选择' },
  { id: 'low', label: 'low', description: '低精度、更快' },
  { id: 'high', label: 'high', description: '高精度' },
  { id: 'original', label: 'original', description: '原图' },
];

const STRICT_TOOLS_OPTIONS: ChoiceOption[] = [
  { id: 'on', label: 'on', description: '启用 strict Function Calling' },
  { id: 'off', label: 'off', description: '关闭 strict Function Calling' },
];

const TOOL_CHOICE_OPTIONS: ChoiceOption[] = [
  { id: 'auto', label: 'auto', description: '由模型决定' },
  { id: 'none', label: 'none', description: '不调用工具' },
  { id: 'required', label: 'required', description: '必须调用工具' },
];

const THEME_OPTIONS: ChoiceOption[] = [
  { id: 'dark', label: 'dark', description: '默认深色' },
  { id: 'light', label: 'light', description: '浅色' },
  { id: 'neon', label: 'neon', description: '霓虹' },
  { id: 'mono', label: 'mono', description: '单色' },
];

const CONFIG_OPTIONS: ChoiceOption[] = [
  { id: 'model', label: '模型', description: '选择当前模型' },
  { id: 'provider', label: '供应商', description: 'deepseek / openai / ...' },
  { id: 'permission', label: '审批模式', description: 'ask / plan / auto' },
  { id: 'reasoning', label: '思考强度', description: 'low / high / max' },
  { id: 'sandbox', label: '沙箱', description: 'read / workspace-write / full / container' },
  { id: 'api-family', label: '接口协议', description: 'chat / responses / anthropic' },
  { id: 'vision-detail', label: '视觉精度', description: 'auto / low / high / original' },
  { id: 'strict-tools', label: 'Strict Tools', description: 'on / off' },
  { id: 'tool-choice', label: '工具策略', description: 'auto / none / required' },
  { id: 'theme', label: '主题', description: 'dark / light / neon / mono' },
  { id: 'api-base', label: 'API 地址', description: '自定义端点' },
  { id: 'api-key', label: 'API Key', description: '加密保存密钥' },
  { id: 'max-tokens', label: '最大 Token', description: '设置输出上限' },
  { id: 'context-budget', label: '上下文预算', description: '自动摘要阈值' },
];

export function useTerminalController({ options }: { options: CliOptions }): TerminalController {
  const { exit } = useApp();
  const { stdin, isRawModeSupported } = useStdin();
  const [entries, setEntries] = useState<UiItem[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [pendingPrompts, setPendingPrompts] = useState<string[]>([]);
  const [activeCommand, setActiveCommand] = useState<ActiveCommand | null>(null);
  const [skillsPanel, setSkillsPanel] = useState<SkillRecord[] | null>(null);
  const [modelPicker, setModelPicker] = useState<ModelPickerState | null>(null);
  const [choicePicker, setChoicePicker] = useState<ChoicePickerState | null>(null);
  const [selectedSkill, setSelectedSkill] = useState(0);
  const [skillsDetail, setSkillsDetail] = useState<SkillRecord | null>(null);
  const [skillsDetailContent, setSkillsDetailContent] = useState('');
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [exitArmed, setExitArmed] = useState(false);
  const [prompt, setPrompt] = useState<PromptState>(null);
  const [model, setModel] = useState(options.model || 'deepseek-v4-pro');
  const [provider, setProvider] = useState<ModelProvider>((options.provider || 'deepseek') as ModelProvider);
  const [apiFamily, setApiFamily] = useState<ApiFamily>('chat');
  const [visionDetail, setVisionDetail] = useState<ImageDetail>('auto');
  const [strictTools, setStrictTools] = useState(true);
  const [mode, setMode] = useState<string>(options.mode || 'ask');
  const [sandbox, setSandbox] = useState<string>(options.sandbox || 'workspace-write');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('high');
  const [toolChoice, setToolChoice] = useState<ToolChoice>('auto');
  const [apiBase, setApiBase] = useState(options.apiBase || '');
  const [maxTokens, setMaxTokens] = useState<number | undefined>(options.maxTokens);
  const [theme, setTheme] = useState<ThemeName>('dark');
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  const [showHome, setShowHome] = useState(!options.noBanner);
  const [branch, setBranch] = useState('main');
  const [homeFocus, setHomeFocus] = useState<'input' | 'commands'>('input');
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggestionSelected, setSuggestionSelected] = useState(false);
  const [commandSuggestionsOpen, setCommandSuggestionsOpen] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [expandedThinking, setExpandedThinking] = useState(false);
  const [expandedActivity, setExpandedActivity] = useState(false);
  const [stats, setStats] = useState<Stats>({ iterations: 0, toolCalls: 0, tokens: '0 in / 0 out' });
  const [elapsed, setElapsed] = useState(0);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const promptRef = useRef<PromptState>(null);
  const sessionRef = useRef<SessionRecord | null>(null);
  const mcpRef = useRef<McpManager | null>(null);
  const pendingPromptsRef = useRef<string[]>([]);
  const startingPendingRef = useRef(false);
  const runPromptRef = useRef<(text: string) => Promise<void>>(async () => {});
  const historyLoadedRef = useRef(false);
  const activitySeqRef = useRef(0);
  const activityToolIdsRef = useRef<Map<string, string[]>>(new Map());
  const modelPickerRequestRef = useRef(0);
  const startedAtRef = useRef(0);
  const sessionStartedAtRef = useRef(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setSessionSeconds(Math.floor((Date.now() - sessionStartedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const historyFile = path.join(getAppPaths().home, 'history.json');
    void fsp
      .readFile(historyFile, 'utf8')
      .then((raw) => {
        const parsed = parseJson(raw);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
          setHistory(parsed.slice(-200));
        }
      })
      .catch(() => {})
      .finally(() => {
        historyLoadedRef.current = true;
      });
  }, []);

  useEffect(() => {
    if (!isRawModeSupported) return;
    process.stdout.write('\x1b[?1000h');
    const handleMouse = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const delta = mouseScrollDelta(text);
      if (delta > 0) setScrollOffset((current) => current + delta);
      if (delta < 0) setScrollOffset((current) => Math.max(0, current + delta));
    };
    stdin.on('data', handleMouse);
    return () => {
      stdin.off('data', handleMouse);
      process.stdout.write('\x1b[?1000l');
    };
  }, [isRawModeSupported, stdin]);

  useEffect(() => {
    if (!historyLoadedRef.current) return;
    const historyFile = path.join(getAppPaths().home, 'history.json');
    void fsp
      .mkdir(path.dirname(historyFile), { recursive: true })
      .then(() => fsp.writeFile(historyFile, `${JSON.stringify(history.slice(-200), null, 2)}\n`, 'utf8'))
      .catch(() => {});
  }, [history]);

  useEffect(() => {
    void loadRuntimeConfig({
      project: options.project,
      model: options.model,
      provider: options.provider,
      apiFamily: options.apiFamily,
      apiBase: options.apiBase,
      mode: options.mode,
      sandbox: options.sandbox,
      visionDetail: options.visionDetail,
      strictTools: options.strictTools,
      reasoningEffort: options.reasoningEffort,
      toolChoice: options.toolChoice,
      maxTokens: options.maxTokens,
      maxSteps: options.maxSteps,
      contextBudget: options.contextBudget,
      theme: options.theme,
    }).then((config) => {
      if (!options.session) setModel(config.model);
      setProvider(config.provider);
      setApiFamily(config.apiFamily);
      setVisionDetail(config.visionDetail);
      setStrictTools(config.strictTools);
      setMode(config.mode);
      setSandbox(config.sandboxMode);
      setReasoningEffort(config.reasoningEffort);
      setToolChoice(config.toolChoice);
      setApiBase(config.apiBase);
      setMaxTokens(config.maxTokens);
      if (config.theme) setTheme(config.theme as ThemeName);
    });
  }, [options.project, options.model, options.provider, options.apiFamily, options.apiBase, options.mode, options.sandbox, options.visionDetail, options.strictTools, options.reasoningEffort, options.toolChoice, options.maxTokens, options.maxSteps, options.contextBudget, options.theme, options.session]);

  useEffect(() => {
    if (!options.session) return;
    const store = new SessionStore({ dir: getAppPaths().sessionsDir });
    void store.load(options.session).then((session) => {
      if (!session) return;
      sessionRef.current = session;
      setModel(session.model);
      if (session.provider) setProvider(session.provider);
      setEntries(sessionToUiItems(session));
      setShowHome(false);
    });
  }, [options.session]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const config = await loadRuntimeConfig({
        project: options.project,
        apiKey: options.apiKey,
        apiBase: options.apiBase,
      });
      const paths = getAppPaths();
      const secret = new SecretStore(paths.credentialsFile, paths.keyFile);
      const stored = await secret.get('DEEPSEEK_API_KEY').catch(() => undefined);
      if (!cancelled) setOnboarding(!config.apiKey && !stored);
    })();
    return () => {
      cancelled = true;
    };
  }, [options.apiKey, options.apiBase, options.project]);

  useEffect(() => {
    const root = options.project ? path.resolve(options.project) : process.cwd();
    execFile('git', ['branch', '--show-current'], { cwd: root, env: safeProcessEnv() }, (error, stdout) => {
      setBranch(!error && stdout.trim() ? stdout.trim() : 'main');
    });
  }, [options.project]);

  useEffect(() => {
    setSuggestionIndex(0);
    setSuggestionSelected(false);
    setCommandSuggestionsOpen(true);
  }, [input]);

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
  const commandSuggestions: CommandHint[] = commandSuggestionsOpen ? matchCommandHints(input) : [];

  const setActivePrompt = (next: PromptState) => {
    promptRef.current = next;
    setPrompt(next);
  };

  const addItem = useCallback((item: UiItem) => {
    setEntries((prev) => [...prev, item]);
  }, []);

  const updateActivity = useCallback((next: ActivityItem) => {
    setActivity((prev) => {
      let index = next.id ? prev.findIndex((item) => item.id === next.id) : -1;
      if (index < 0) {
        for (let cursor = prev.length - 1; cursor >= 0; cursor -= 1) {
          const candidate = prev[cursor];
          if (candidate.kind === next.kind && candidate.name === next.name && candidate.status === 'running') {
            index = cursor;
            break;
          }
        }
      }
      if (index < 0) {
        const id = next.id || `activity-${activitySeqRef.current++}`;
        return [...prev, { ...next, id }];
      }
      const copy = [...prev];
      copy[index] = { ...copy[index], ...next };
      return copy;
    });
  }, []);

  const setPendingQueue = useCallback((next: string[]) => {
    pendingPromptsRef.current = next;
    setPendingPrompts(next);
  }, []);

  const enqueuePrompt = useCallback(
    (text: string) => {
      setPendingQueue(appendPendingPrompt(pendingPromptsRef.current, text));
    },
    [setPendingQueue],
  );

  const withdrawLastPending = useCallback(() => {
    const { withdrawn, rest } = popPendingPrompt(pendingPromptsRef.current);
    if (!withdrawn) return null;
    setPendingQueue(rest);
    return withdrawn;
  }, [setPendingQueue]);

  const finishRun = useCallback(() => {
    setRunning(false);
    startingPendingRef.current = false;
    controllerRef.current = null;
    const { next, rest } = takeNextPendingPrompt(pendingPromptsRef.current);
    if (!next) return;
    setPendingQueue(rest);
    void runPromptRef.current(next);
  }, [setPendingQueue]);

  const saveOnboardingApiKey = useCallback(async (apiKey: string) => {
    const paths = getAppPaths();
    const secret = new SecretStore(paths.credentialsFile, paths.keyFile);
    await secret.set('DEEPSEEK_API_KEY', apiKey);
  }, []);

  const completeOnboarding = useCallback(
    async (selectedModel: string, selectedEffort: ReasoningEffort) => {
      setModel(selectedModel);
      setReasoningEffort(selectedEffort);
      await saveRuntimeConfig({
        model: selectedModel,
        provider,
        reasoningEffort: selectedEffort,
        theme,
      });
      setOnboarding(false);
      setShowHome(!options.noBanner);
      addItem({
        kind: 'system',
        text: `已完成初始配置：${selectedModel} · 思考深度 ${selectedEffort}`,
      });
    },
    [addItem, options.noBanner, provider, theme],
  );

  const openModelPicker = useCallback(async () => {
    const requestId = modelPickerRequestRef.current + 1;
    modelPickerRequestRef.current = requestId;
    setChoicePicker(null);
    setActiveCommand(null);
    setCommandSuggestionsOpen(false);
    setModelPicker({ models: [], source: 'live', selected: 0 });
    try {
      const config = await loadRuntimeConfig({
        project: options.project,
        model,
        provider,
        apiFamily,
        apiBase,
        apiKey: options.apiKey,
      });
      const paths = getAppPaths();
      const secret = new SecretStore(paths.credentialsFile, paths.keyFile);
      const storedKey =
        (await secret.get('AURAXIS_API_KEY').catch(() => undefined)) ||
        (await secret.get(apiKeyEnvName(config.provider)).catch(() => undefined));
      const apiKey = config.apiKey || storedKey || '';
      const result = await resolveModelChoices(apiKey, config.apiBase, undefined, config.provider);
      if (requestId !== modelPickerRequestRef.current) return;
      const local: ModelPickerState['models'] =
        config.provider === 'deepseek'
          ? BUILT_IN_MODELS.map((item) => ({
              id: item.id,
              name: item.name,
              provider: 'deepseek',
              experimental: 'experimental' in item ? item.experimental : undefined,
            }))
          : [];
      const custom: ModelPickerState['models'] = config.customModels.map((item) => ({
        id: item.id,
        name: item.name,
        provider: item.provider || 'custom',
        experimental: item.experimental,
      }));
      const merged = new Map<string, ModelPickerState['models'][number]>();
      for (const choice of [...(result.source === 'live' ? result.models : local), ...custom]) {
        merged.set(choice.id, choice);
      }
      const models = [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
      const selected = Math.max(
        0,
        models.findIndex((item) => item.id === config.model),
      );
      setModelPicker({
        models,
        source: result.source,
        selected,
      });
      if (models.length === 0) {
        addItem({ kind: 'system', text: '当前供应商暂未返回可用模型，请先在配置中注册 customModels。' });
      }
    } catch (error) {
      if (requestId !== modelPickerRequestRef.current) return;
      setModelPicker(null);
      addItem({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  }, [addItem, apiBase, apiFamily, model, options.apiKey, options.project, provider]);

  const applySelectedModel = useCallback(
    (selectedId: string) => {
      modelPickerRequestRef.current += 1;
      setModel(selectedId);
      void saveRuntimeConfig({ model: selectedId });
      void (async () => {
        const config = await loadRuntimeConfig({
          project: options.project,
          model: selectedId,
          provider,
          apiFamily,
          apiBase,
          apiKey: options.apiKey,
        });
        const custom = config.customModels.find((item) => item.id === selectedId);
        if (custom) {
          setProvider(custom.provider || 'custom');
          setApiBase(custom.apiBase || '');
          if (custom.apiFamily) setApiFamily(custom.apiFamily);
          if (custom.strictTools !== undefined) setStrictTools(custom.strictTools);
        } else if (config.provider === 'deepseek') {
          setProvider('deepseek');
        }
      })();
      if (sessionRef.current) {
        const currentSession = sessionRef.current;
        currentSession.model = selectedId;
        void (async () => {
          const store = new SessionStore({ dir: getAppPaths().sessionsDir });
          await store.save(currentSession);
        })();
      }
      setModelPicker(null);
      setInput('');
      addItem({ kind: 'system', text: `已切换模型：${selectedId}` });
    },
    [addItem, apiBase, apiFamily, options.apiKey, options.project, provider],
  );

  const openChoicePicker = useCallback(
    (kind: ChoicePickerKind, title: string, options: ChoiceOption[], selectedId?: string) => {
      const selected = Math.max(
        0,
        options.findIndex((option) => option.id === selectedId),
      );
      setModelPicker(null);
      setActiveCommand(null);
      setCommandSuggestionsOpen(false);
      setInput('');
      setChoicePicker({ kind, title, options, selected });
    },
    [],
  );

  const openConfigPicker = useCallback(() => {
    openChoicePicker('config', '设置', CONFIG_OPTIONS);
  }, [openChoicePicker]);

  const openSessionPicker = useCallback(
    async (mode: 'resume' | 'delete') => {
      try {
        const store = new SessionStore({ dir: getAppPaths().sessionsDir });
        const sessions = await store.list(options.project ? path.resolve(options.project) : undefined);
        const sessionChoices: ChoiceOption[] = sessions.map((session) => ({
          id: session.id,
          label: session.id,
          description:
            `${new Date(session.updatedAt).toLocaleString()} · ` +
            (chatMessageText(session.messages.find((message) => message.role === 'user')?.content).slice(0, 48) || '(空)'),
        }));
        if (sessionChoices.length === 0) {
          setChoicePicker(null);
          addItem({ kind: 'system', text: '暂无会话' });
          return;
        }
        openChoicePicker(
          mode === 'resume' ? 'session-resume' : 'session-delete',
          mode === 'resume' ? '选择会话' : '删除会话',
          sessionChoices,
        );
      } catch (error) {
        setChoicePicker(null);
        addItem({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
      }
    },
    [addItem, openChoicePicker, options.project],
  );

  const applyChoicePicker = useCallback(
    (kind: Exclude<ChoicePickerKind, 'config'>, selectedId: string) => {
      switch (kind) {
        case 'permission':
          if (!['ask', 'plan', 'auto'].includes(selectedId)) return;
          setMode(selectedId);
          void saveRuntimeConfig({ mode: selectedId as 'ask' | 'plan' | 'auto' });
          addItem({ kind: 'system', text: `已切换审批模式：${selectedId}` });
          break;
        case 'reasoning':
          if (!['low', 'high', 'max'].includes(selectedId)) return;
          setReasoningEffort(selectedId as ReasoningEffort);
          void saveRuntimeConfig({ reasoningEffort: selectedId as ReasoningEffort });
          addItem({ kind: 'system', text: `已切换思考强度：${selectedId}` });
          break;
        case 'sandbox':
          if (!['read', 'workspace-write', 'full', 'container'].includes(selectedId)) return;
          setSandbox(selectedId);
          void saveRuntimeConfig({ sandboxMode: selectedId as 'read' | 'workspace-write' | 'full' | 'container' });
          addItem({ kind: 'system', text: `已切换沙箱：${selectedId}` });
          break;
        case 'provider':
          if (!['deepseek', 'openai', 'anthropic', 'gemini', 'ollama', 'custom'].includes(selectedId)) return;
          setProvider(selectedId as ModelProvider);
          setApiBase('');
          void saveRuntimeConfig({ provider: selectedId as ModelProvider });
          if (sessionRef.current) {
            const currentSession = sessionRef.current;
            currentSession.provider = selectedId as ModelProvider;
            void (async () => {
              const store = new SessionStore({ dir: getAppPaths().sessionsDir });
              await store.save(currentSession);
            })();
          }
          addItem({ kind: 'system', text: `已切换供应商：${selectedId}` });
          break;
        case 'api-family':
          if (!['chat', 'responses', 'anthropic'].includes(selectedId)) return;
          setApiFamily(selectedId as ApiFamily);
          setApiBase('');
          void saveRuntimeConfig({ apiFamily: selectedId as ApiFamily });
          addItem({ kind: 'system', text: `已切换接口协议：${selectedId}` });
          break;
        case 'vision-detail':
          if (!['low', 'high', 'original', 'auto'].includes(selectedId)) return;
          setVisionDetail(selectedId as ImageDetail);
          void saveRuntimeConfig({ visionDetail: selectedId as ImageDetail });
          addItem({ kind: 'system', text: `已切换视觉精度：${selectedId}` });
          break;
        case 'strict-tools':
          if (!['on', 'off'].includes(selectedId)) return;
          setStrictTools(selectedId === 'on');
          void saveRuntimeConfig({ strictTools: selectedId === 'on' });
          addItem({ kind: 'system', text: `Strict Tools：${selectedId}` });
          break;
        case 'tool-choice':
          if (!['auto', 'none', 'required'].includes(selectedId)) return;
          setToolChoice(selectedId as ToolChoice);
          void saveRuntimeConfig({ toolChoice: selectedId as ToolChoice });
          addItem({ kind: 'system', text: `已切换工具策略：${selectedId}` });
          break;
        case 'theme':
          if (!['dark', 'light', 'neon', 'mono'].includes(selectedId)) return;
          setTheme(selectedId as ThemeName);
          void saveRuntimeConfig({ theme: selectedId as ThemeName });
          addItem({ kind: 'system', text: `已切换主题：${selectedId}` });
          break;
        case 'session-resume':
          void (async () => {
            const store = new SessionStore({ dir: getAppPaths().sessionsDir });
            const session = await store.load(selectedId);
            if (!session) {
              addItem({ kind: 'error', text: `找不到会话 ${selectedId}` });
              return;
            }
            sessionRef.current = session;
            setModel(session.model);
            if (session.provider) setProvider(session.provider);
            setShowHome(false);
            setEntries(sessionToUiItems(session));
            addItem({ kind: 'system', text: `已恢复会话 ${session.id} · ${session.messages.length} 条消息` });
          })().catch((error) => {
            addItem({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
          });
          break;
        case 'session-delete':
          void (async () => {
            const store = new SessionStore({ dir: getAppPaths().sessionsDir });
            await store.remove(selectedId);
            addItem({ kind: 'system', text: `已删除会话 ${selectedId}` });
          })().catch((error) => {
            addItem({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
          });
          break;
        default:
          return;
      }
      setChoicePicker(null);
      setInput('');
    },
    [addItem],
  );

  const openConfigAction = useCallback(
    (selectedId: string) => {
      switch (selectedId) {
        case 'model':
          void openModelPicker();
          break;
        case 'provider':
          openChoicePicker('provider', '选择供应商', PROVIDER_OPTIONS, provider);
          break;
        case 'permission':
          openChoicePicker('permission', '选择审批模式', PERMISSION_OPTIONS, mode);
          break;
        case 'reasoning':
          openChoicePicker('reasoning', '选择思考强度', REASONING_OPTIONS, reasoningEffort);
          break;
        case 'sandbox':
          openChoicePicker('sandbox', '选择沙箱策略', SANDBOX_OPTIONS, sandbox);
          break;
        case 'api-family':
          openChoicePicker('api-family', '选择接口协议', API_FAMILY_OPTIONS, apiFamily);
          break;
        case 'vision-detail':
          openChoicePicker('vision-detail', '选择视觉精度', VISION_DETAIL_OPTIONS, visionDetail);
          break;
        case 'strict-tools':
          openChoicePicker('strict-tools', 'Strict Tools', STRICT_TOOLS_OPTIONS, strictTools ? 'on' : 'off');
          break;
        case 'tool-choice':
          openChoicePicker('tool-choice', '选择工具策略', TOOL_CHOICE_OPTIONS, toolChoice);
          break;
        case 'theme':
          openChoicePicker('theme', '选择主题', THEME_OPTIONS, theme);
          break;
        case 'api-base':
          setChoicePicker(null);
          setActiveCommand({ key: 'api-base', label: 'API 地址', placeholder: '输入 API Base URL…' });
          break;
        case 'api-key':
          setChoicePicker(null);
          setActiveCommand({ key: 'api-key', label: 'API Key', placeholder: '输入 API Key…' });
          break;
        case 'max-tokens':
          setChoicePicker(null);
          setActiveCommand({ key: 'max-tokens', label: '最大 Token', placeholder: '输入 token 数量…' });
          break;
        case 'context-budget':
          setChoicePicker(null);
          setActiveCommand({ key: 'context-budget', label: '上下文预算', placeholder: '输入 token 数量…' });
          break;
        default:
          setChoicePicker(null);
          addItem({ kind: 'system', text: `未知设置项 ${selectedId}` });
      }
    },
    [
      addItem,
      apiFamily,
      mode,
      openChoicePicker,
      openModelPicker,
      provider,
      reasoningEffort,
      sandbox,
      strictTools,
      theme,
      toolChoice,
      visionDetail,
    ],
  );

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

  const saveSession = useCallback(async (session: SessionRecord, messages: ChatMessage[], text: string, model: string, provider: ModelProvider) => {
    const store = new SessionStore({ dir: getAppPaths().sessionsDir });
    session.messages = messages;
    session.summary = text.slice(0, 500);
    session.model = model;
    session.provider = provider;
    await store.save(session);
  }, []);

  const runWorktreeCommand = useCallback(async (body: string) => {
    const [action, ...args] = body.trim().split(/\s+/).filter(Boolean);
    try {
      if (action === 'list') {
        const worktrees = await listWorktrees(projectFull);
        addItem({
          kind: 'system',
          text: worktrees.length
            ? worktrees.map((item) => `${item.id} · ${item.branch} · ${item.path}`).join('\n')
            : '暂无 worktree',
        });
      } else if (action === 'remove') {
        if (!args[0]) {
          addItem({ kind: 'system', text: '需要 worktree ID' });
          return;
        }
        await removeWorktree(projectFull, args[0]);
        addItem({ kind: 'system', text: `已移除 worktree ${args[0]}` });
      } else {
        const worktree = await createWorktree(projectFull, args.join(' ') || undefined);
        addItem({ kind: 'system', text: `已创建 worktree ${worktree.id} · ${worktree.path}` });
      }
    } catch (error) {
      addItem({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  }, [addItem, projectFull]);

  const runCheckpointCommand = useCallback(async (body: string) => {
    const [action, ...args] = body.trim().split(/\s+/).filter(Boolean);
    try {
      if (action === 'list') {
        const checkpoints = await listCheckpoints(projectFull);
        addItem({
          kind: 'system',
          text: checkpoints.length
            ? checkpoints.map((item) => `${item.id} · ${item.name} · ${new Date(item.createdAt).toLocaleString()}`).join('\n')
            : '暂无 checkpoint',
        });
      } else if (action === 'restore') {
        if (!args[0]) {
          addItem({ kind: 'system', text: '需要 checkpoint ID' });
          return;
        }
        await restoreCheckpoint(projectFull, args[0]);
        addItem({ kind: 'system', text: `已恢复 checkpoint ${args[0]}` });
      } else {
        const checkpoint = await createCheckpoint(projectFull, args.join(' ') || 'checkpoint');
        addItem({ kind: 'system', text: `已创建 checkpoint ${checkpoint.id} · ${checkpoint.name}` });
      }
    } catch (error) {
      addItem({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  }, [addItem, projectFull]);

  const runFilesCommand = useCallback(async (body: string) => {
    const [action, ...rest] = body.trim().split(/\s+/).filter(Boolean);
    try {
      const config = await loadRuntimeConfig({
        project: options.project,
        model,
        provider,
        apiFamily,
        apiKey: options.apiKey,
        apiBase,
      });
      const paths = getAppPaths();
      const secret = new SecretStore(paths.credentialsFile, paths.keyFile);
      const apiKey =
        config.apiKey ||
        (await secret.get('DEEPSEEK_API_KEY').catch(() => undefined)) ||
        '';
      if (!apiKey) {
        addItem({ kind: 'error', text: '未配置 DeepSeek API Key，无法使用 Files API' });
        return;
      }
      const files = new DeepSeekFilesClient({
        provider: config.provider,
        apiKey,
        apiBase: config.apiBase,
        headers: config.headers,
      });
      if (!action || action === 'list') {
        const result = await files.list();
        addItem({
          kind: 'system',
          text: result.data.length
            ? result.data.map((file) => `${file.id} · ${file.filename || '图片'} · ${Math.round(file.bytes / 1024)}KB`).join('\n')
            : '暂无已上传文件',
        });
      } else if (action === 'upload' && rest[0]) {
        const filePath = path.resolve(projectFull, rest[0]);
        const name = path.basename(filePath);
        const extension = path.extname(filePath).toLowerCase();
        const mimeType =
          extension === '.png'
            ? 'image/png'
            : extension === '.gif'
              ? 'image/gif'
              : extension === '.webp'
                ? 'image/webp'
                : 'image/jpeg';
        const buffer = await fsp.readFile(filePath);
        const uploaded = await files.upload({ name, buffer, mimeType });
        addItem({ kind: 'system', text: `已上传 ${uploaded.id} · ${uploaded.filename || name}` });
      } else if (action === 'delete' && rest[0]) {
        const result = await files.delete(rest[0]);
        addItem({ kind: 'system', text: `已删除文件 ${result.id}` });
      } else if (action === 'info' && rest[0]) {
        const file = await files.retrieve(rest[0]);
        addItem({
          kind: 'system',
          text: `${file.id} · ${file.filename || '图片'} · ${Math.round(file.bytes / 1024)}KB${file.expires_at ? ` · 过期 ${new Date(file.expires_at * 1000).toLocaleString()}` : ''}`,
        });
      } else {
        addItem({ kind: 'system', text: '用法: /files list | upload <path> | info <id> | delete <id>' });
      }
    } catch (error) {
      addItem({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  }, [addItem, apiBase, apiFamily, model, options.apiKey, options.project, projectFull, provider]);

  const runCompletionCommand = useCallback(async (body: string) => {
    const [mode, ...parts] = body.trim().split(/\s+/);
    const value = parts.join(' ');
    if (!value) {
      addItem({ kind: 'system', text: '请输入要补全的内容' });
      return;
    }
    try {
      const config = await loadRuntimeConfig({
        project: options.project,
        model,
        provider,
        apiFamily,
        apiKey: options.apiKey,
        apiBase,
      });
      const paths = getAppPaths();
      const secret = new SecretStore(paths.credentialsFile, paths.keyFile);
      const apiKey = config.apiKey || (await secret.get('DEEPSEEK_API_KEY').catch(() => undefined)) || '';
      if (!apiKey) {
        addItem({ kind: 'error', text: '未配置 DeepSeek API Key，无法补全' });
        return;
      }
      const client = new DeepSeekClient(
        apiKey,
        config.apiBase,
        config.model,
        config.maxTokens,
        3,
        true,
        config.strictTools,
        config.headers,
      );
      const completion =
        mode === 'fim'
          ? await client.completeFim({
              prompt: value.split('||')[0] || '',
              suffix: value.includes('||') ? value.split('||')[1] : undefined,
              maxTokens: Math.min(config.maxTokens, 4096),
            })
          : await client.completePrefix({ prefix: value, maxTokens: config.maxTokens });
      addItem({ kind: 'assistant', text: completion || '(无补全结果)' });
    } catch (error) {
      addItem({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  }, [addItem, apiBase, apiFamily, model, options.apiKey, options.project, provider]);

  const reloadMcpManager = useCallback(async () => {
    await mcpRef.current?.close().catch(() => {});
    mcpRef.current = null;
    const manager = new McpManager(await loadMcpServers(projectFull));
    await manager.start();
    mcpRef.current = manager;
    for (const error of manager.errors) {
      addItem({ kind: 'system', text: `[MCP] ${error}` });
    }
    return manager;
  }, [addItem, projectFull]);

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
          {
            const activityId = `tool-${activitySeqRef.current++}`;
            const ids = activityToolIdsRef.current.get(event.toolName) || [];
            activityToolIdsRef.current.set(event.toolName, [...ids, activityId]);
            updateActivity({
              id: activityId,
              kind: 'tool',
              name: event.toolName,
              status: 'running',
              summary: summarizeToolInput(event.toolName, event.input),
            });
          }
          break;
        case 'tool_end':
          appendTool(event.toolName, `${event.toolName} · ${event.durationMs}ms`, true, event.durationMs, undefined, event.outputPreview);
          {
            const ids = activityToolIdsRef.current.get(event.toolName) || [];
            const activityId = ids.pop();
            if (ids.length) activityToolIdsRef.current.set(event.toolName, ids);
            else activityToolIdsRef.current.delete(event.toolName);
            updateActivity({
              id: activityId,
              kind: 'tool',
              name: event.toolName,
              status: 'done',
              duration: event.durationMs,
              output: event.outputPreview,
            });
          }
          break;
        case 'tool_error':
          appendTool(event.toolName, `${event.toolName} 失败`, false, undefined, event.error);
          {
            const ids = activityToolIdsRef.current.get(event.toolName) || [];
            const activityId = ids.pop();
            if (ids.length) activityToolIdsRef.current.set(event.toolName, ids);
            else activityToolIdsRef.current.delete(event.toolName);
            updateActivity({
              id: activityId,
              kind: 'tool',
              name: event.toolName,
              status: 'error',
              error: event.error,
            });
          }
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
    [addItem, appendAssistant, appendThinking, appendTool, updateActivity],
  );

  const executePrompt = useCallback(
    async (promptText: string) => {
      const config = await loadRuntimeConfig({
        project: options.project,
        model,
        provider,
        apiFamily,
        apiKey: options.apiKey,
        apiBase,
        mode,
        sandbox,
        visionDetail,
        strictTools,
        reasoningEffort,
        toolChoice,
        maxTokens,
        maxSteps: options.maxSteps,
        contextBudget: options.contextBudget,
      });
      const paths = getAppPaths();
      const secret = new SecretStore(paths.credentialsFile, paths.keyFile);
      const storedKey = (
        await Promise.all(
          [
            apiKeyEnvName(config.provider),
            'AURAXIS_API_KEY',
            'DEEPSEEK_API_KEY',
            'ANTHROPIC_API_KEY',
            'GEMINI_API_KEY',
            'OPENAI_API_KEY',
            'OLLAMA_API_KEY',
          ].map((name) => secret.get(name).catch(() => undefined)),
        )
      ).find(Boolean);
      const apiKey = config.apiKey || storedKey || '';
      if (!apiKey) {
        addItem({ kind: 'error', text: '未配置 API Key，请设置对应供应商的环境变量或使用 /api-key 保存。' });
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
        if (!session) session = await store.create(config.projectRoot, config.model, config.provider);
        sessionRef.current = session;
      }
      const resumeMessages = session.messages || [];
      const controller = new AbortController();
      controllerRef.current = controller;
      startedAtRef.current = Date.now();
      setStats({ iterations: 0, toolCalls: 0, tokens: '0 in / 0 out' });
      setActivity([]);
      setActiveCommand(null);
      setModelPicker(null);
      setChoicePicker(null);
      activitySeqRef.current = 0;
      activityToolIdsRef.current.clear();
      setSkillsPanel(null);
      setSkillsDetail(null);
      setSkillsDetailContent('');
      setSelectedSkill(0);
      setShowHelp(false);
      setExpandedThinking(false);
      setExpandedActivity(false);
      setScrollOffset(0);
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
      const onPlanEdit = async (plan: Plan) => {
        const raw = await askUser(
          '请输入修改后的计划，每行格式：任务ID|任务描述|状态(pending/running/completed/blocked)，直接回车保留原计划。',
        );
        const lines = raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (!lines.length) return plan;
        const tasks = lines.map((line, index) => {
          const [id = '', description = '', status = 'pending'] = line.split(/\s*\|\s*/);
          const normalizedStatus =
            (status === 'running' || status === 'completed' || status === 'blocked'
              ? status
              : 'pending') as Plan['tasks'][number]['status'];
          return {
            id: id || String(index + 1),
            description,
            status: normalizedStatus,
          };
        });
        return { ...plan, tasks };
      };
      const askUser = async (question: string) => {
        return new Promise<string>((resolve) => {
          setActivePrompt({ kind: 'ask', question, resolve });
        });
      };

      try {
        const result = await runAgent({
          prompt: promptText,
          projectRoot: config.projectRoot,
          model: config.model,
          provider: config.provider,
          apiFamily: config.apiFamily,
          apiKey,
          apiBase: config.apiBase,
          headers: config.headers,
          supportsImages: config.supportsImages,
          mode: config.mode,
          sandboxMode: config.sandboxMode,
          maxTokens: config.maxTokens,
          maxSteps: config.maxSteps,
          contextBudget: config.contextBudget,
          reasoningEffort: config.reasoningEffort,
          toolChoice: config.toolChoice,
          visionDetail: config.visionDetail,
          strictTools: config.strictTools,
          tools,
          mcp: mcpManager,
          sessionId: session.id,
          resumeMessages,
          signal: controller.signal,
          onEvent: handleEvent,
          requestPermission,
          onPlanApproval,
          onPlanEdit,
          askUser,
        });
        await saveSession(session, result.messages, result.text, model, provider);
        if (result.aborted) addItem({ kind: 'system', text: '任务已取消' });
      } catch (error) {
        addItem({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
      }
    },
    [addItem, appendAssistant, handleEvent, model, provider, apiFamily, mode, options, sandbox, saveSession, visionDetail, strictTools, reasoningEffort, toolChoice, apiBase, maxTokens],
  );

  const runPrompt = useCallback(
    async (promptText: string) => {
      startingPendingRef.current = true;
      setRunning(true);
      try {
        await executePrompt(promptText);
      } catch (error) {
        addItem({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
      } finally {
        finishRun();
      }
    },
    [addItem, executePrompt, finishRun],
  );
  runPromptRef.current = runPrompt;

  const executeCodeFile = useCallback(
    async (fileArg: string) => {
      const config = await loadRuntimeConfig({
        project: options.project,
        model,
        provider,
        apiFamily,
        apiKey: options.apiKey,
        apiBase,
        mode,
        sandbox,
        visionDetail,
        strictTools,
        reasoningEffort,
        toolChoice,
        maxTokens,
        maxSteps: options.maxSteps,
      });
      const paths = getAppPaths();
      const secret = new SecretStore(paths.credentialsFile, paths.keyFile);
      const apiKey = config.apiKey || (await secret.get('DEEPSEEK_API_KEY').catch(() => undefined)) || '';
      if (!apiKey) {
        addItem({ kind: 'error', text: '未配置 DeepSeek API Key，请设置 DEEPSEEK_API_KEY 后重试。' });
        return;
      }
      const codePath = path.resolve(projectFull, fileArg);
      let code: string;
      try {
        code = await fsp.readFile(codePath, 'utf8');
      } catch {
        addItem({ kind: 'error', text: `无法读取 Code Mode 文件: ${codePath}` });
        return;
      }
      let mcpManager = mcpRef.current;
      if (!mcpManager) {
        mcpManager = new McpManager(await loadMcpServers(config.projectRoot));
        await mcpManager.start();
        mcpRef.current = mcpManager;
        for (const error of mcpManager.errors) {
          addItem({ kind: 'system', text: `[MCP] ${error}` });
        }
      }
      const controller = new AbortController();
      controllerRef.current = controller;
      startedAtRef.current = Date.now();
      setStats({ iterations: 0, toolCalls: 0, tokens: '0 in / 0 out' });
      setActivity([]);
      setActiveCommand(null);
      setModelPicker(null);
      setChoicePicker(null);
      activitySeqRef.current = 0;
      activityToolIdsRef.current.clear();
      setSkillsPanel(null);
      setSkillsDetail(null);
      setSkillsDetailContent('');
      setSelectedSkill(0);
      setShowHelp(false);
      setExpandedActivity(false);
      setScrollOffset(0);
      setRunning(true);
      setInput('');
      addItem({ kind: 'system', text: `▶ Code Mode 运行 ${codePath}` });

      const requestPermission = async (request: PermissionRequest) =>
        new Promise<'allow_once' | 'allow_session' | 'allow_rule' | 'deny'>((resolve) => {
          setActivePrompt({ kind: 'permission', request, resolve });
        });
      const askUser = async (question: string) =>
        new Promise<string>((resolve) => {
          setActivePrompt({ kind: 'ask', question, resolve });
        });
      const codeLsp = await LspManager.fromEnv(projectFull);
      const toolContext: ToolContext = {
        projectRoot: projectFull,
        sessionId: `code-${Date.now().toString(36)}`,
        files: new DeepSeekFilesClient({
          provider: config.provider,
          apiKey,
          apiBase: config.apiBase,
          headers: config.headers,
        }),
        supportsImages: config.supportsImages,
        visionDetail: config.visionDetail,
        undo: new UndoStore(path.join(getAppPaths().home, 'undo')),
        memory: MemoryStore.project(projectFull),
        mailbox: SessionMailbox.global(),
        lsp: codeLsp || undefined,
        sandbox: new SandboxPolicy({ mode: config.sandboxMode, projectRoot: config.projectRoot }),
        emit: () => {},
        askUser,
        todos: [],
        setTodos: () => {},
        signal: controller.signal,
        mcp: mcpManager,
      };
      const updateSubCall = (call: CodeModeSubCall) => {
        const status =
          call.status === 'done' ? 'done' : call.status === 'error' ? 'error' : call.status === 'aborted' ? 'aborted' : 'running';
        updateActivity({
          id: `code-${call.id}`,
          kind: 'code',
          name: call.name,
          status,
          duration: call.durationMs,
          error: call.error,
        });
        const nextItem: UiItem = {
          kind: 'code_tool',
          toolName: call.name,
          text: call.name,
          status,
          ok: call.status === 'done',
          error: call.error,
          duration: call.durationMs,
          subCallId: call.id,
        };
        setEntries((prev) => {
          const index = prev.findIndex((item) => item.kind === 'code_tool' && item.subCallId === call.id);
          if (index < 0) return [...prev, nextItem];
          const copy = [...prev];
          copy[index] = nextItem;
          return copy;
        });
      };

      try {
        const codeHooks = await loadHooks(projectFull);
        const result = await runCodeProgram(code, {
          projectRoot: projectFull,
          requestId: `code-${Date.now().toString(36)}`,
          signal: controller.signal,
          onEvent: (event: CodeModeEvent) => {
            switch (event.type) {
              case 'code_start':
                addItem({ kind: 'code', text: 'Code Mode', codeRunning: true, lines: [] });
                updateActivity({ id: 'code-main', kind: 'code', name: 'Code Mode', status: 'running' });
                break;
              case 'code_log':
                setEntries((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.kind === 'code') {
                    return [...prev.slice(0, -1), { ...last, lines: [...(last.lines || []), event.line] }];
                  }
                  return [...prev, { kind: 'code', text: 'Code Mode', codeRunning: true, lines: [event.line] }];
                });
                break;
              case 'code_tool_start':
              case 'code_tool_end':
              case 'code_tool_error':
                updateSubCall(event.call);
                break;
              case 'code_done':
                updateActivity({
                  id: 'code-main',
                  kind: 'code',
                  name: 'Code Mode',
                  status: 'done',
                  output:
                    `exit=${event.result.exitCode} · tools=${event.result.subCalls.length} · ` +
                    `timedOut=${event.result.timedOut}`,
                });
                setEntries((prev) => {
                  const last = prev[prev.length - 1];
                  const updated = last?.kind === 'code' ? [...prev.slice(0, -1), { ...last, codeRunning: false }] : prev;
                  return [
                    ...updated,
                    {
                      kind: 'system',
                      text: `Code Mode 结束 · exit=${event.result.exitCode} · tools=${event.result.subCalls.length} · timedOut=${event.result.timedOut}`,
                    },
                  ];
                });
                break;
              default:
                break;
            }
          },
          executeTool: async (name, input, ctx) => {
            const preDispatch = await runHooksFor(
              'pre_tool_use',
              { projectRoot: projectFull, requestId: ctx.requestId, toolName: name, input },
              projectFull,
              codeHooks,
            );
            if (preDispatch.blocked) {
              const detail = preDispatch.outputs.filter(Boolean).join('\n').trim();
              return { output: null, error: `Hook 阻止执行 ${name}${detail ? `：${detail.slice(0, 240)}` : ''}` };
            }
            const staticTool = getTool(name);
            const mcpDefinition = mcpManager.getDefinition(name);
            if (!staticTool && !mcpDefinition) return { output: null, error: `未知工具: ${name}` };
            const decision = await requestPermission({
              requestId: `code-${Date.now().toString(36)}`,
              tool: name,
              summary: summarizeToolInput(name, input),
              args: input,
              danger: staticTool?.definition.danger ?? 'mcp',
            });
            if (decision === 'deny') return { output: null, error: `用户拒绝执行 ${name}` };
            try {
              let output: CodeModeExecuteResult;
              if (staticTool) {
                const toolOutput = await staticTool.runner(input, { ...toolContext, signal: ctx.signal });
                output = { output: toolOutput.content };
              } else {
                output = { output: await mcpManager.call(mcpDefinition!.mcpServer!, name, input) };
              }
              await runHooksFor(
                'post_tool_use',
                { projectRoot: projectFull, requestId: ctx.requestId, toolName: name, input, ok: !output.error },
                projectFull,
                codeHooks,
              );
              return output;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              await runHooksFor(
                'post_tool_use',
                { projectRoot: projectFull, requestId: ctx.requestId, toolName: name, input, ok: false, error: message },
                projectFull,
                codeHooks,
              );
              return { output: null, error: message };
            }
          },
        });
        if (result.timedOut) addItem({ kind: 'system', text: 'Code Mode 程序超时，已强制终止' });
        if (result.aborted) addItem({ kind: 'system', text: 'Code Mode 程序已取消' });
      } catch (error) {
        addItem({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
      } finally {
        await codeLsp?.close().catch(() => {});
      }
    },
    [addItem, apiBase, apiFamily, maxTokens, model, options, projectFull, provider, reasoningEffort, sandbox, strictTools, toolChoice, updateActivity, visionDetail],
  );

  const runCodeFile = useCallback(
    async (fileArg: string) => {
      startingPendingRef.current = true;
      setRunning(true);
      try {
        await executeCodeFile(fileArg);
      } catch (error) {
        addItem({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
      } finally {
        finishRun();
      }
    },
    [addItem, executeCodeFile, finishRun],
  );

  const submit = useCallback((valueOverride?: string) => {
    if (activeCommand) {
      const command = activeCommand;
      const value = (valueOverride ?? input).trim();
      if (!value) {
        addItem({ kind: 'system', text: '内容为空' });
        return;
      }
      setActiveCommand(null);
      setInput('');
      if (command.key === 'agents') {
        void runPrompt(`请使用多 Agent 能力处理任务：${value}`);
      } else if (command.key === 'code') {
        void runCodeFile(value);
      } else if (command.key === 'run') {
        void runPrompt(`请运行文件 ${value}，并只给出结果摘要。`);
      } else if (command.key === 'plugin-install') {
        void (async () => {
          try {
            const plugin = await installPlugin(value, projectFull);
            addItem({ kind: 'system', text: `已安装插件 ${plugin.manifest.id} · ${plugin.manifest.name}` });
          } catch (error) {
            addItem({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
          }
        })();
      } else if (command.key === 'memory-remember') {
        const parts = value.split('|').map((part) => part.trim());
        const title = parts.shift() || '';
        const content = parts.join(' | ').trim() || value;
        void (async () => {
          const record = await MemoryStore.project(projectFull).remember(title, content);
          addItem({ kind: 'system', text: `已保存记忆 ${record.id} · ${record.title}` });
        })();
      } else if (command.key === 'max-tokens' && /^\d+$/.test(value)) {
        const next = Math.max(1, Math.floor(Number(value)));
        setMaxTokens(next);
        void saveRuntimeConfig({ maxTokens: next });
      } else if (command.key === 'context-budget' && /^\d+$/.test(value)) {
        const nextContextBudget = Math.max(1000, Math.floor(Number(value)));
        void saveRuntimeConfig({ contextBudget: nextContextBudget });
        addItem({ kind: 'system', text: `上下文预算已设为 ${nextContextBudget}` });
      } else if (command.key === 'api-base') {
        setApiBase(value);
        void saveRuntimeConfig({ apiBase: value });
      } else if (command.key === 'api-key') {
        void (async () => {
          const paths = getAppPaths();
          const store = new SecretStore(paths.credentialsFile, paths.keyFile);
          const keyName = apiKeyEnvName(provider);
          await store.set(keyName, value);
        })();
      } else if (command.key === 'symbol') {
        void (async () => {
          const symbols = await findSymbols(projectFull, value, 20);
          addItem({
            kind: 'system',
            text: symbols.length
              ? symbols.map((item) => `${item.name} · ${item.file}:${item.line}`).join('\n')
              : '未找到符号',
          });
        })();
      } else if (command.key === 'worktree') {
        void runWorktreeCommand(value);
      } else if (command.key === 'checkpoint') {
        void runCheckpointCommand(value);
      } else if (command.key === 'files') {
        void runFilesCommand(value || 'list');
      } else if (command.key === 'complete') {
        void runCompletionCommand(value);
      } else if (command.key === 'fim') {
        void runCompletionCommand(`fim ${value}`);
      } else {
        addItem({ kind: 'error', text: `无法识别 ${command.key} 的值：${value}` });
      }
      return;
    }
    const value = (valueOverride ?? input).trim();
    if (!value) return;
    setHistory((prev) => (prev[prev.length - 1] === value ? prev : [...prev, value].slice(-100)));
    setHistoryIndex(null);
    if (running || startingPendingRef.current) {
      if (value.startsWith('/')) {
        addItem({ kind: 'system', text: '运行中暂不支持排队命令，请等待当前任务结束。' });
        return;
      }
      enqueuePrompt(value);
      setInput('');
      return;
    }
    if (value.startsWith('/')) {
      const [rawCommand, ...rest] = value.slice(1).split(/\s+/);
      const command = resolveCommandAlias(rawCommand);
      const body = rest.join(' ');
      if (command === 'help') {
        setShowHelp(true);
        setInput('');
        return;
      } else if (command === 'clear') {
        setEntries([]);
      setActivity([]);
      setScrollOffset(0);
      setPendingQueue([]);
      setActiveCommand(null);
      setModelPicker(null);
      setChoicePicker(null);
      activityToolIdsRef.current.clear();
        setSkillsPanel(null);
        setSkillsDetail(null);
        setSkillsDetailContent('');
        setModelPicker(null);
        setChoicePicker(null);
        setShowHelp(false);
      } else if (command === 'quit' || command === 'exit') {
        void mcpRef.current?.close();
        exit();
      } else if (command === 'status') {
        const detail = [
          `模型: ${model}`,
          `供应商: ${provider}`,
          `接口协议: ${apiFamily}`,
          `沙箱: ${sandbox}`,
          `权限: ${mode}`,
          `分支: ${branch}`,
          `会话: ${formatSessionTime(sessionSeconds)}`,
          `项目路径: ${projectFull}`,
          `思考强度: ${reasoningEffort}`,
          `视觉精度: ${visionDetail}`,
          `Strict Tools: ${strictTools ? 'on' : 'off'}`,
          `工具选择: ${toolChoice}`,
          `API: ${apiBase}`,
          `最大输出: ${maxTokens ?? '默认'}`,
          `主题: ${theme}`,
          `迭代: ${stats.iterations}`,
          `工具: ${stats.toolCalls}`,
          `耗时: ${elapsed}s`,
        ].join('\n');
        addItem({ kind: 'system', text: `当前状态\n${detail}` });
      } else if (command === 'tools') {
        const mcpTools = mcpRef.current?.getToolDefinitions() || [];
        addItem({
          kind: 'system',
          text: [
            ...getTools().map((tool) => `${tool.name} [${tool.danger}]`),
            ...mcpTools.map((tool) => `${tool.name} [mcp]${tool.mcpServer ? ` · ${tool.mcpServer}` : ''}`),
          ].join('\n'),
        });
      } else if (command === 'history') {
        addItem({ kind: 'system', text: history.length ? history.slice(-20).join('\n') : '暂无历史命令' });
      } else if (command === 'audit') {
        void (async () => {
          const sessionId = sessionRef.current?.id || '';
          const records = sessionId ? await AuditStore.session(projectFull, sessionId).read(100) : [];
          addItem({
            kind: 'system',
            text: records.length
              ? records.map((record) => `${new Date(record.ts).toLocaleTimeString()} · ${record.type}`).join('\n')
              : '暂无审计记录',
          });
        })();
      } else if (command === 'mcp') {
        const [mcpAction, ...mcpArgs] = body.split(/\s+/).filter(Boolean);
        if (mcpAction === 'reload') {
          void reloadMcpManager().then((manager) => {
            addItem({ kind: 'system', text: `已重新加载 MCP · ${manager.getToolDefinitions().length} 个工具` });
          });
        } else if (mcpAction === 'add' && mcpArgs.length >= 2) {
          const [name, command, ...args] = mcpArgs;
          void (async () => {
            const file = path.join(getAppPaths().configDir, 'mcp.json');
            const parsed = parseJson(await fsp.readFile(file, 'utf8').catch(() => ''));
            const parsedObject = asJsonObject(parsed);
            const existingServers = (
              Array.isArray(parsed)
                ? parsed
                : Array.isArray(parsedObject.servers)
                  ? parsedObject.servers
                  : []
            ).map((server) => asJsonObject(server));
            const servers = existingServers.filter((server) => server.name !== name);
            servers.push({ name, command, args });
            await fsp.mkdir(path.dirname(file), { recursive: true });
            await fsp.writeFile(file, `${JSON.stringify({ servers }, null, 2)}\n`, 'utf8');
            const manager = await reloadMcpManager();
            addItem({ kind: 'system', text: `已添加 MCP 服务 ${name} · ${manager.getToolDefinitions().length} 个工具` });
          })();
        } else if (mcpAction === 'remove' && mcpArgs[0]) {
          const name = mcpArgs[0];
          void (async () => {
            const file = path.join(getAppPaths().configDir, 'mcp.json');
            const parsed = parseJson(await fsp.readFile(file, 'utf8').catch(() => ''));
            if (parsed === undefined) {
              addItem({ kind: 'error', text: '没有已保存的 MCP 配置' });
              return;
            }
            const parsedObject = asJsonObject(parsed);
            const existingServers = (
              Array.isArray(parsed)
                ? parsed
                : Array.isArray(parsedObject.servers)
                  ? parsedObject.servers
                  : []
            ).map((server) => asJsonObject(server));
            const servers = existingServers.filter((server) => server.name !== name);
            await fsp.mkdir(path.dirname(file), { recursive: true });
            await fsp.writeFile(file, `${JSON.stringify({ servers }, null, 2)}\n`, 'utf8');
            await reloadMcpManager();
            addItem({ kind: 'system', text: `已移除 MCP 服务 ${name}` });
          })();
        } else {
          const manager = mcpRef.current;
          const tools = manager?.getToolDefinitions() || [];
          addItem({
            kind: 'system',
            text: tools.length
              ? tools.map((tool) => `${tool.name} · ${tool.mcpServer || 'MCP'}`).join('\n')
              : '尚未连接 MCP 服务',
          });
        }
      } else if (command === 'skills') {
        void (async () => {
          const skills = await scanSkills(options.project ? path.resolve(options.project) : process.cwd());
          setActiveCommand(null);
          setSkillsPanel(skills);
          setSelectedSkill(0);
          setSkillsDetail(null);
          setSkillsDetailContent('');
          setShowHome(false);
        })();
      } else if (command === 'memory') {
        void (async () => {
          const [action, ...rest] = body.split(/\s+/);
          const store = MemoryStore.project(projectFull);
          if (action === 'remember' && rest.length >= 2) {
            const title = rest[0];
            const content = rest.slice(1).join(' ');
            const record = await store.remember(title, content);
            addItem({ kind: 'system', text: `已保存记忆 ${record.id} · ${record.title}` });
          } else if (action === 'remember') {
            setActiveCommand({
              key: 'memory-remember',
              label: '保存记忆',
              placeholder: '输入 标题 | 记忆内容…',
            });
          } else if (action === 'search') {
            const records = await store.search(rest.join(' '), 10);
            addItem({
              kind: 'system',
              text: records.length ? records.map((record) => `${record.title}: ${record.content.slice(0, 240)}`).join('\n') : '暂无记忆',
            });
          } else {
            const records = await store.search('', 10);
            addItem({
              kind: 'system',
              text: records.length ? records.map((record) => `${record.title}: ${record.content.slice(0, 240)}`).join('\n') : '暂无记忆',
            });
          }
        })();
      } else if (command === 'symbol') {
        if (body) {
          void (async () => {
            const symbols = await findSymbols(projectFull, body, 20);
            addItem({
              kind: 'system',
              text: symbols.length ? symbols.map((item) => `${item.name} · ${item.file}:${item.line}`).join('\n') : '未找到符号',
            });
          })();
        } else {
          setActiveCommand({ key: 'symbol', label: '符号查找', placeholder: '输入符号关键字…' });
        }
      } else if (command === 'plugins') {
        void (async () => {
          const [action, ...args] = body.split(/\s+/).filter(Boolean);
          if (action === 'install') {
            const source = args.join(' ');
            if (!source) {
              setActiveCommand({
                key: 'plugin-install',
                label: '安装插件',
                placeholder: '输入插件目录路径…',
              });
              return;
            }
            const plugin = await installPlugin(source, projectFull);
            addItem({ kind: 'system', text: `已安装插件 ${plugin.manifest.id} · ${plugin.manifest.name}` });
          } else if (action === 'discover') {
            const plugins = await discoverMarketplace();
            addItem({
              kind: 'system',
              text: plugins.length
                ? plugins.map((plugin) => `${plugin.id} · ${plugin.name}${plugin.version ? ` v${plugin.version}` : ''}`).join('\n')
                : '未配置 AURAXIS_PLUGIN_MARKETPLACE',
            });
          } else {
            const plugins = await scanPlugins(projectFull, process.env.AURAXIS_TRUST_PROJECT_HOOKS === '1');
            addItem({
              kind: 'system',
              text: plugins.length
                ? plugins.map((plugin) => `${plugin.manifest.id} · ${plugin.manifest.name}${plugin.manifest.version ? ` v${plugin.manifest.version}` : ''}`).join('\n')
                : '暂无插件，使用 /plugins install <目录> 安装本地插件',
            });
          }
        })();
      } else if (command === 'doctor') {
        void (async () => {
          const manager = mcpRef.current;
          const skills = await scanSkills(options.project ? path.resolve(options.project) : process.cwd());
          addItem({
            kind: 'system',
            text: `模型: ${model}\n供应商: ${provider}\n模式: ${mode}\n沙箱: ${sandbox}\n工具: ${getTools().length + (manager?.getToolDefinitions().length || 0)}\n技能: ${skills.length}\nMCP: ${manager?.getToolDefinitions().length || 0}`,
          });
        })();
      } else if (command === 'sessions') {
        void openSessionPicker('resume');
      } else if (command === 'session') {
        void (async () => {
          const store = new SessionStore({ dir: getAppPaths().sessionsDir });
          if (!body || body === 'list') {
            void openSessionPicker('resume');
          } else if (body === 'new') {
            const next = await store.create(projectFull, model, provider);
            sessionRef.current = next;
            setEntries([]);
            setShowHome(false);
            setPendingQueue([]);
            addItem({ kind: 'system', text: `已创建新会话 ${next.id}` });
          } else {
            const session = await store.load(body);
            if (!session) {
              addItem({ kind: 'error', text: `找不到会话 ${body}` });
              return;
            }
            sessionRef.current = session;
            setModel(session.model);
            if (session.provider) setProvider(session.provider);
            setShowHome(false);
            setPendingQueue([]);
            setEntries(sessionToUiItems(session));
            addItem({ kind: 'system', text: `已恢复会话 ${session.id} · ${session.messages.length} 条消息` });
          }
        })();
      } else if (command === 'delete') {
        if (body) {
          void (async () => {
            const store = new SessionStore({ dir: getAppPaths().sessionsDir });
            await store.remove(body);
            addItem({ kind: 'system', text: `已删除会话 ${body}` });
          })();
        } else {
          void openSessionPicker('delete');
        }
      } else if (command === 'agents') {
        if (body) {
          void runPrompt(`请使用多 Agent 能力处理任务：${body}`);
        } else {
          setActiveCommand({
            key: 'agents',
            label: '多 Agent',
            placeholder: '输入要分发的任务…',
          });
        }
      } else if (command === 'review') {
        void runPrompt('使用 ReviewArtifact 检查当前项目的测试、类型检查或构建。');
      } else if (command === 'git') {
        void runPrompt('使用 GitStatus、GitDiff、GitLog 检查当前仓库状态。');
      } else if (command === 'run') {
        if (body) {
          void runPrompt(`请运行文件 ${body}，并只给出结果摘要。`);
        } else {
          setActiveCommand({
            key: 'run',
            label: '运行文件',
            placeholder: '输入要运行的文件路径…',
          });
        }
      } else if (command === 'code') {
        if (body) {
          void runCodeFile(body);
        } else {
          setActiveCommand({
            key: 'code',
            label: 'Code Mode',
            placeholder: '输入 TypeScript 文件路径…',
          });
        }
      } else if (command === 'init') {
        void (async () => {
          const configPath = path.join(projectFull, '.auraxis.json');
          try {
            await fsp.access(configPath);
            addItem({ kind: 'system', text: `项目已初始化：${configPath}` });
          } catch {
            await fsp.writeFile(
              configPath,
              `${JSON.stringify({ model, permissionMode: mode, sandboxMode: sandbox, reasoningEffort }, null, 2)}\n`,
              'utf8',
            );
            addItem({ kind: 'system', text: `已创建项目配置：${configPath}` });
          }
        })();
      } else if (command === 'config') {
        openConfigPicker();
        setActiveCommand(null);
        setInput('');
        setCommandSuggestionsOpen(false);
      } else if (command === 'model') {
        setActiveCommand(null);
        setInput('');
        setCommandSuggestionsOpen(false);
        void openModelPicker();
      } else if (command === 'provider') {
        if (['deepseek', 'openai', 'anthropic', 'gemini', 'ollama', 'custom'].includes(body)) {
          applyChoicePicker('provider', body);
        } else {
          openChoicePicker('provider', '选择供应商', PROVIDER_OPTIONS, provider);
        }
      } else if (command === 'api-family') {
        if (['chat', 'responses', 'anthropic'].includes(body)) {
          applyChoicePicker('api-family', body);
        } else {
          openChoicePicker('api-family', '选择接口协议', API_FAMILY_OPTIONS, apiFamily);
        }
      } else if (command === 'vision-detail') {
        if (['low', 'high', 'original', 'auto'].includes(body)) {
          applyChoicePicker('vision-detail', body);
        } else {
          openChoicePicker('vision-detail', '选择视觉精度', VISION_DETAIL_OPTIONS, visionDetail);
        }
      } else if (command === 'strict-tools') {
        if (['on', 'off'].includes(body)) {
          applyChoicePicker('strict-tools', body);
        } else {
          openChoicePicker('strict-tools', 'Strict Tools', STRICT_TOOLS_OPTIONS, strictTools ? 'on' : 'off');
        }
      } else if (command === 'mode' || command === 'permission') {
        if (['ask', 'plan', 'auto'].includes(body)) {
          applyChoicePicker('permission', body);
        } else {
          openChoicePicker('permission', '选择审批模式', PERMISSION_OPTIONS, mode);
        }
      } else if (command === 'sandbox') {
        if (['read', 'workspace-write', 'full', 'container'].includes(body)) {
          applyChoicePicker('sandbox', body);
        } else {
          openChoicePicker('sandbox', '选择沙箱策略', SANDBOX_OPTIONS, sandbox);
        }
      } else if (command === 'effort' || command === 'reasoning') {
        if (['low', 'high', 'max'].includes(body)) {
          applyChoicePicker('reasoning', body);
        } else {
          openChoicePicker('reasoning', '选择思考强度', REASONING_OPTIONS, reasoningEffort);
        }
      } else if (command === 'tool-choice') {
        if (['auto', 'none', 'required'].includes(body)) {
          applyChoicePicker('tool-choice', body);
        } else {
          openChoicePicker('tool-choice', '选择工具策略', TOOL_CHOICE_OPTIONS, toolChoice);
        }
      } else if (command === 'api-base') {
        if (body) {
          setApiBase(body);
          void saveRuntimeConfig({ apiBase: body });
        } else {
          setActiveCommand({ key: 'api-base', label: 'API 地址', placeholder: '输入 API Base URL…' });
        }
      } else if (command === 'max-tokens') {
        if (/^\d+$/.test(body)) {
          const nextMaxTokens = Math.max(1, Math.floor(Number(body)));
          setMaxTokens(nextMaxTokens);
          void saveRuntimeConfig({ maxTokens: nextMaxTokens });
        } else {
          setActiveCommand({ key: 'max-tokens', label: '最大 Token', placeholder: '输入 token 数量…' });
        }
      } else if (command === 'context-budget') {
        if (/^\d+$/.test(body)) {
          const nextContextBudget = Math.max(1000, Math.floor(Number(body)));
          void saveRuntimeConfig({ contextBudget: nextContextBudget });
          addItem({ kind: 'system', text: `上下文预算已设为 ${nextContextBudget}` });
        } else {
          setActiveCommand({ key: 'context-budget', label: '上下文预算', placeholder: '输入 token 数量…' });
        }
      } else if (command === 'api-key') {
        if (body) {
          void (async () => {
            const paths = getAppPaths();
            const store = new SecretStore(paths.credentialsFile, paths.keyFile);
            const keyName = apiKeyEnvName(provider);
            await store.set(keyName, body);
            addItem({ kind: 'system', text: `${keyName} 已加密保存` });
          })();
        } else {
          setActiveCommand({ key: 'api-key', label: 'API Key', placeholder: '输入 API Key…' });
        }
      } else if (command === 'theme') {
        if (['dark', 'light', 'neon', 'mono'].includes(body)) {
          applyChoicePicker('theme', body);
        } else {
          openChoicePicker('theme', '选择主题', THEME_OPTIONS, theme);
        }
      } else if (command === 'home') {
        setActiveCommand(null);
        setSkillsPanel(null);
        setSkillsDetail(null);
        setSkillsDetailContent('');
        setModelPicker(null);
        setChoicePicker(null);
        setShowHome(true);
        setScrollOffset(0);
        setShowHelp(false);
        setHomeFocus('input');
        setSelectedCommand(0);
      } else if (command === 'worktree') {
        if (body) {
          void runWorktreeCommand(body);
        } else {
          setActiveCommand({
            key: 'worktree',
            label: 'Worktree',
            placeholder: '输入 create [branch] / list / remove <id>…',
          });
        }
      } else if (command === 'checkpoint') {
        if (body) {
          void runCheckpointCommand(body);
        } else {
          setActiveCommand({
            key: 'checkpoint',
            label: 'Checkpoint',
            placeholder: '输入 create [name] / list / restore <id>…',
          });
        }
      } else if (command === 'files') {
        if (body) {
          void runFilesCommand(body);
        } else {
          setActiveCommand({
            key: 'files',
            label: 'Files API',
            placeholder: '输入 list / upload <path> / info <id> / delete <id>…',
          });
        }
      } else if (command === 'complete') {
        if (body) {
          void runCompletionCommand(body);
        } else {
          setActiveCommand({
            key: 'complete',
            label: '前缀补全',
            placeholder: '输入要补全的前缀…',
          });
        }
      } else if (command === 'fim') {
        if (body) {
          void runCompletionCommand(`fim ${body}`);
        } else {
          setActiveCommand({
            key: 'fim',
            label: 'FIM 补全',
            placeholder: '输入 前缀||后缀…',
          });
        }
      } else {
        addItem({ kind: 'system', text: `未知命令 ${command}` });
      }
      setInput('');
      return;
    }
    setInput('');
    void runPrompt(value);
  }, [addItem, activeCommand, applyChoicePicker, enqueuePrompt, exit, history, input, running, model, provider, apiFamily, visionDetail, strictTools, mode, options.project, projectFull, sandbox, reasoningEffort, toolChoice, apiBase, maxTokens, runPrompt, reloadMcpManager, runCodeFile, runWorktreeCommand, runCheckpointCommand, runFilesCommand, runCompletionCommand, openChoicePicker, openConfigPicker, openModelPicker, openSessionPicker]);

  useInput((keyInput, key) => {
    if (onboarding) return;
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

    if (activeCommand) {
      if (key.escape || (key.ctrl && keyInput.toLowerCase() === 'c')) {
        setActiveCommand(null);
        setInput('');
        return;
      }
      if (key.return) {
        submit();
        return;
      }
      if (key.backspace) {
        setInput((prev) => prev.slice(0, -1));
      } else if (key.ctrl && keyInput.toLowerCase() === 'j') {
        setInput((prev) => `${prev}\n`);
      } else if (key.ctrl && keyInput.toLowerCase() === 'u') {
        setInput('');
      } else if (key.ctrl && keyInput.toLowerCase() === 'w') {
        setInput((prev) => prev.replace(/\s*\S*$/, ''));
      } else if (!key.ctrl && !key.meta && keyInput && keyInput !== '\r' && keyInput !== '\n') {
        setInput((prev) => prev + keyInput);
      }
      return;
    }

    if (choicePicker) {
      if (key.escape || (key.ctrl && keyInput.toLowerCase() === 'c')) {
        setChoicePicker(null);
        return;
      }
      if (choicePicker.options.length === 0) return;
      if (key.upArrow || key.downArrow) {
        setChoicePicker((current) =>
          current
            ? {
                ...current,
                selected:
                  (current.selected + (key.upArrow ? -1 : 1) + current.options.length) %
                  current.options.length,
              }
            : current,
        );
        return;
      }
      if (key.return) {
        const selected = choicePicker.options[Math.min(choicePicker.selected, choicePicker.options.length - 1)];
        if (!selected) return;
        if (choicePicker.kind === 'config') {
          openConfigAction(selected.id);
        } else {
          applyChoicePicker(choicePicker.kind, selected.id);
        }
        return;
      }
      return;
    }

    if (modelPicker) {
      if (key.escape || (key.ctrl && keyInput.toLowerCase() === 'c')) {
        modelPickerRequestRef.current += 1;
        setModelPicker(null);
        return;
      }
      if (modelPicker.models.length === 0) return;
      if (key.upArrow || key.downArrow) {
        setModelPicker((current) =>
          current
            ? {
                ...current,
                selected:
                  (current.selected + (key.upArrow ? -1 : 1) + current.models.length) %
                  current.models.length,
              }
            : current,
        );
        return;
      }
      if (key.return) {
        const selected = modelPicker.models[Math.min(modelPicker.selected, modelPicker.models.length - 1)];
        if (selected) applySelectedModel(selected.id);
        return;
      }
      return;
    }

    if (skillsPanel) {
      if (skillsDetail) {
        if (key.escape) setSkillsDetail(null);
        return;
      }
      if (key.escape) {
        setSkillsPanel(null);
        setSkillsDetail(null);
        setSkillsDetailContent('');
        return;
      }
      if (skillsPanel.length === 0) return;
      if (key.upArrow || key.downArrow) {
        setSelectedSkill((current) =>
          key.upArrow
            ? (current - 1 + skillsPanel.length) % skillsPanel.length
            : (current + 1) % skillsPanel.length,
        );
        return;
      }
      if (key.return) {
        const skill = skillsPanel[Math.min(selectedSkill, skillsPanel.length - 1)];
        if (skill) {
          void readSkillContent(skill)
            .then((content) => {
              setSkillsDetail(skill);
              setSkillsDetailContent(content.slice(0, 4000));
            })
            .catch((error) => {
              setSkillsDetail(skill);
              setSkillsDetailContent(error instanceof Error ? error.message : String(error));
            });
        }
        return;
      }
      return;
    }

    if (showHome) {
      if (key.tab) {
        setMode((current) => {
          const next = current === 'ask' ? 'plan' : current === 'plan' ? 'auto' : 'ask';
          void saveRuntimeConfig({ mode: next as 'ask' | 'plan' | 'auto' });
          return next;
        });
        return;
      }
      if (key.leftArrow || key.rightArrow) {
        setHomeFocus('commands');
        setSelectedCommand((current) => (key.leftArrow ? current - 1 + HOME_COMMANDS.length : current + 1) % HOME_COMMANDS.length);
        return;
      }
      if (homeFocus === 'commands') {
        const digit = Number(keyInput);
        if (Number.isInteger(digit) && digit >= 1 && digit <= HOME_COMMANDS.length) {
          setSelectedCommand(digit - 1);
          submit(HOME_COMMANDS[digit - 1].command);
          return;
        }
        if (key.return) {
          submit(HOME_COMMANDS[selectedCommand].command);
          return;
        }
        if (key.escape) {
          setHomeFocus('input');
          return;
        }
      }
    }

    if (showHelp) {
      if (key.escape || (key.ctrl && keyInput.toLowerCase() === 'p')) {
        setShowHelp(false);
      }
      return;
    }

    if (key.ctrl && keyInput.toLowerCase() === 'p') {
      setShowHelp((current) => !current);
      return;
    }
    if (key.ctrl && keyInput.toLowerCase() === 'o') {
      setExpandedActivity((current) => !current);
      return;
    }
    if (key.ctrl && keyInput.toLowerCase() === 'z') {
      const withdrawn = withdrawLastPending();
      if (withdrawn) {
        addItem({ kind: 'system', text: `已撤回等待任务：${withdrawn.slice(0, 80)}` });
      }
      return;
    }
    if (key.ctrl && keyInput.toLowerCase() === 'l') {
      setEntries([]);
      setActivity([]);
      setScrollOffset(0);
      setPendingQueue([]);
      return;
    }
    if (key.ctrl && keyInput.toLowerCase() === 'u') {
      setInput('');
      setSuggestionIndex(0);
      setSuggestionSelected(false);
      return;
    }
    if (key.ctrl && keyInput.toLowerCase() === 'w' && !running) {
      setInput((prev) => prev.replace(/\s*\S*$/, ''));
      setSuggestionIndex(0);
      setSuggestionSelected(false);
      return;
    }

    const suggestions = commandSuggestionsOpen ? matchCommandHints(input) : [];
    if (!running && suggestions.length > 0) {
      if (key.upArrow) {
        setSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
        setSuggestionSelected(true);
        return;
      }
      if (key.downArrow || key.tab) {
        setSuggestionIndex((current) => (current + 1) % suggestions.length);
        setSuggestionSelected(true);
        return;
      }
      if (key.return) {
        const selected = suggestions[Math.min(suggestionIndex, suggestions.length - 1)];
        if (selected) {
          const command = resolveSuggestedCommand(input, suggestions, suggestionIndex);
          setInput(command);
          submit(command);
          setSuggestionIndex(0);
          setSuggestionSelected(false);
        } else {
          submit();
        }
        return;
      }
      if (key.escape) {
        setCommandSuggestionsOpen(false);
        setSuggestionSelected(false);
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
    if (key.ctrl && keyInput === 't') {
      setExpandedThinking((current) => !current);
      return;
    }
    if (!running && key.pageUp) {
      setScrollOffset((current) => current + 4);
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
    if (key.backspace) {
      setInput((prev) => prev.slice(0, -1));
    } else if (key.ctrl && keyInput === 'j') {
      setInput((prev) => `${prev}\n`);
    } else if (!key.ctrl && !key.meta && keyInput && keyInput !== '\r' && keyInput !== '\n') {
      setInput((prev) => prev + keyInput);
    }
  });

  return {
    entries,
    activity,
    pendingPrompts,
    activeCommand,
    skillsPanel,
    modelPicker,
    choicePicker,
    selectedSkill,
    skillsDetail,
    skillsDetailContent,
    input,
    running,
    exitArmed,
    prompt,
    model,
    provider,
    apiFamily,
    visionDetail,
    strictTools,
    mode,
    sandbox,
    reasoningEffort,
    toolChoice,
    apiBase,
    maxTokens,
    theme,
    onboarding,
    showHome,
    branch,
    homeFocus,
    selectedCommand,
    commandSuggestions,
    suggestionIndex,
    showHelp,
    expandedThinking,
    expandedActivity,
    stats,
    elapsed,
    sessionSeconds,
    scrollOffset,
    projectLabel,
    projectFull,
    saveOnboardingApiKey,
    completeOnboarding,
  };

}
