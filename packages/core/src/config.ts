import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  ApiFamily,
  ApprovalPolicy,
  ImageDetail,
  McpServerConfig,
  ModelProvider,
  ReasoningEffort,
  SandboxMode,
  ToolChoice,
} from './types.js';
import { scanPlugins } from './plugins.js';
import {
  asJsonObject,
  customModelConfigSchema,
  mcpServerConfigSchema,
  parseJson,
  parseJsonObject,
} from './validation.js';

export const DEEPSEEK_API_ORIGIN = 'https://api.deepseek.com';
export const DEFAULT_API_BASE = `${DEEPSEEK_API_ORIGIN}/beta/chat/completions`;
export const DEFAULT_RESPONSES_API_BASE = `${DEEPSEEK_API_ORIGIN}/responses`;
export const DEFAULT_DEEPSEEK_ANTHROPIC_API_BASE = `${DEEPSEEK_API_ORIGIN}/anthropic/v1/messages`;

export const BUILT_IN_MODELS = [
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek', maxTokens: 384000, contextWindow: 1_000_000 },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek', maxTokens: 384000, contextWindow: 1_000_000 },
  {
    id: 'deepseek-v4-flash-vision-exp',
    name: 'DeepSeek V4 Flash Vision Exp',
    provider: 'deepseek',
    maxTokens: 384000,
    contextWindow: 1_000_000,
    supportsImages: true,
    experimental: true,
  },
] as const;

export interface AppPaths {
  home: string;
  configDir: string;
  sessionsDir: string;
  credentialsFile: string;
  keyFile: string;
}

export interface CustomModelConfig {
  id: string;
  name: string;
  provider?: ModelProvider;
  apiFamily?: ApiFamily;
  apiBase?: string;
  apiKeyEnv?: string;
  headers?: Record<string, string>;
  contextWindow?: number;
  maxTokens?: number;
  supportsImages?: boolean;
  strictTools?: boolean;
  experimental?: boolean;
}

export function getAppPaths(): AppPaths {
  const home = process.env.AURAXIS_HOME || path.join(os.homedir(), '.auraxis');
  const configDir = path.join(home, 'config');
  return {
    home,
    configDir,
    sessionsDir: path.join(home, 'sessions'),
    credentialsFile: path.join(configDir, 'credentials.json'),
    keyFile: path.join(configDir, 'machine.key'),
  };
}

export interface RuntimeConfig {
  projectRoot: string;
  model: string;
  provider: ModelProvider;
  apiFamily: ApiFamily;
  apiKey?: string;
  apiBase: string;
  headers?: Record<string, string>;
  supportsImages?: boolean;
  mode: ApprovalPolicy;
  sandboxMode: SandboxMode;
  theme?: string;
  reasoningEffort: ReasoningEffort;
  visionDetail: ImageDetail;
  strictTools: boolean;
  maxTokens: number;
  maxIterations: number;
  contextBudget: number;
  toolChoice: ToolChoice;
  customModels: CustomModelConfig[];
}

export interface ConfigOverrides {
  project?: string;
  model?: string;
  provider?: string;
  apiFamily?: string;
  apiKey?: string;
  apiBase?: string;
  mode?: string;
  sandbox?: string;
  visionDetail?: string;
  strictTools?: boolean;
  theme?: string;
  reasoningEffort?: string;
  maxTokens?: number;
  maxIterations?: number;
  contextBudget?: number;
  toolChoice?: string;
}

const PROJECT_ENV_SECURITY_KEYS = new Set([
  'AURAXIS_ALLOW_UNSAFE_CODE',
  'AURAXIS_CONTAINER_IMAGE',
  'AURAXIS_CONTAINER_NETWORK',
  'AURAXIS_CONTAINER_RUNNER',
  'AURAXIS_CONTAINER_WORKDIR',
  'AURAXIS_HOME',
  'AURAXIS_LSP_ARGS',
  'AURAXIS_LSP_COMMAND',
  'AURAXIS_LSP_INIT_OPTIONS',
  'AURAXIS_MCP_SERVERS',
  'AURAXIS_PLUGIN_MARKETPLACE',
  'AURAXIS_PWSH',
  'AURAXIS_PYTHON_BIN',
  'AURAXIS_REMOTE_API',
  'AURAXIS_REMOTE_TOKEN',
  'AURAXIS_SHELL',
  'AURAXIS_TRUST_PROJECT_HOOKS',
  'AURAXIS_TRUST_PROJECT_MCP',
]);

function isProjectSecurityEnvKey(key: string): boolean {
  return PROJECT_ENV_SECURITY_KEYS.has(key);
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return parseJsonObject(raw) || {};
  } catch {
    return {};
  }
}

function parseCustomModels(raw: unknown): CustomModelConfig[] {
  if (!Array.isArray(raw)) return [];
  const models: CustomModelConfig[] = [];
  for (const item of raw) {
    const parsed = customModelConfigSchema.safeParse(item);
    if (!parsed.success) continue;
    const value = parsed.data;
    models.push({
      id: value.id,
      name: value.name,
      provider: normalizeModelProvider(value.provider),
      apiFamily: normalizeApiFamily(value.apiFamily),
      apiBase: value.apiBase,
      apiKeyEnv: value.apiKeyEnv,
      headers: value.headers,
      contextWindow: value.contextWindow,
      maxTokens: value.maxTokens,
      supportsImages: value.supportsImages === true,
      strictTools: value.strictTools === true,
      experimental: value.experimental === true,
    });
  }
  return models;
}

function normalizeModelProvider(value: unknown): ModelProvider {
  if (
    value === 'deepseek' ||
    value === 'openai' ||
    value === 'anthropic' ||
    value === 'gemini' ||
    value === 'ollama' ||
    value === 'custom'
  ) {
    return value;
  }
  return 'custom';
}

async function loadDotEnv(root: string): Promise<void> {
  const file = path.join(root, '.env');
  try {
    const raw = await fs.readFile(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // 项目目录中的 .env 不允许自行提升信任级别或改变安全边界。
      if (isProjectSecurityEnvKey(key)) continue;
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    /* no .env is fine */
  }
}

function normalizeMode(value: unknown): ApprovalPolicy {
  if (value === 'auto' || value === 'afe') return 'auto';
  if (value === 'plan') return 'plan';
  return 'ask';
}

function normalizeSandbox(value: unknown): SandboxMode {
  if (value === 'read' || value === 'full' || value === 'container') return value;
  return 'workspace-write';
}

function normalizeEffort(value: unknown): ReasoningEffort {
  if (value === 'low' || value === 'high' || value === 'max') return value;
  return 'high';
}

function normalizeApiFamily(value: unknown): ApiFamily {
  if (value === 'responses' || value === 'anthropic') return value;
  return 'chat';
}

function normalizeImageDetail(value: unknown): ImageDetail {
  if (value === 'low' || value === 'high' || value === 'original' || value === 'auto') return value;
  return 'auto';
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value === 'true' || value === '1' || value === 'on' || value === 'yes';
}

function normalizeToolChoice(value: unknown): ToolChoice {
  if (value === 'auto' || value === 'none' || value === 'required') return value;
  return 'auto';
}

function isMode(value: unknown): value is ApprovalPolicy {
  return value === 'ask' || value === 'plan' || value === 'auto';
}

function isSandbox(value: unknown): value is SandboxMode {
  return value === 'read' || value === 'workspace-write' || value === 'full' || value === 'container';
}

function isEffort(value: unknown): value is ReasoningEffort {
  return value === 'low' || value === 'high' || value === 'max';
}

export async function loadRuntimeConfig(overrides: ConfigOverrides = {}): Promise<RuntimeConfig> {
  const projectRoot = path.resolve(overrides.project || process.cwd());
  await loadDotEnv(projectRoot);
  const paths = getAppPaths();
  const globalConfig = await readJson(path.join(paths.configDir, 'config.json'));
  const projectConfig = await readJson(path.join(projectRoot, '.auraxis.json'));
  const customModels = [
    ...parseCustomModels(globalConfig.customModels),
    ...parseCustomModels(projectConfig.customModels),
  ];

  const model =
    overrides.model ||
    (typeof globalConfig.model === 'string' && globalConfig.model) ||
    (typeof projectConfig.model === 'string' && projectConfig.model) ||
    process.env.AURAXIS_MODEL ||
    'deepseek-v4-pro';
  const customModel = customModels.find((item) => item.id === model);
  const builtInModel = BUILT_IN_MODELS.find((item) => item.id === model);
  const providerValue =
    overrides.provider ||
    customModel?.provider ||
    BUILT_IN_MODELS.find((item) => item.id === model)?.provider ||
    process.env.AURAXIS_PROVIDER ||
    'deepseek';
  const provider = normalizeModelProvider(providerValue);
  const familyValue =
    overrides.apiFamily ||
    customModel?.apiFamily ||
    projectConfig.apiFamily ||
    globalConfig.apiFamily ||
    process.env.AURAXIS_API_FAMILY;
  const apiFamily = normalizeApiFamily(familyValue || (provider === 'anthropic' ? 'anthropic' : 'chat'));
  const providerDefaultBase =
    provider === 'anthropic'
      ? 'https://api.anthropic.com/v1/messages'
      : provider === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
      : provider === 'gemini'
          ? 'https://generativelanguage.googleapis.com/v1beta'
        : provider === 'ollama'
          ? 'http://localhost:11434/v1/chat/completions'
          : apiFamily === 'responses'
            ? DEFAULT_RESPONSES_API_BASE
            : apiFamily === 'anthropic'
              ? DEFAULT_DEEPSEEK_ANTHROPIC_API_BASE
              : DEFAULT_API_BASE;

  const apiBase =
    overrides.apiBase ||
    process.env.AURAXIS_API_BASE ||
    process.env.DEEPSEEK_BASE_URL ||
    customModel?.apiBase ||
    (typeof globalConfig.apiBase === 'string' && globalConfig.apiBase) ||
    (typeof projectConfig.apiBase === 'string' && projectConfig.apiBase) ||
    providerDefaultBase;

  const modeValue = overrides.mode || projectConfig.permissionMode || globalConfig.permissionMode || process.env.AURAXIS_MODE;
  const sandboxValue = overrides.sandbox || projectConfig.sandboxMode || globalConfig.sandboxMode || process.env.AURAXIS_SANDBOX;
  const effortValue =
    overrides.reasoningEffort || projectConfig.reasoningEffort || globalConfig.reasoningEffort || process.env.AURAXIS_REASONING_EFFORT;
  const toolChoiceValue = overrides.toolChoice || projectConfig.toolChoice || globalConfig.toolChoice || process.env.AURAXIS_TOOL_CHOICE;
  const themeValue = overrides.theme || projectConfig.theme || globalConfig.theme || process.env.AURAXIS_THEME;
  const visionDetailValue = overrides.visionDetail || projectConfig.visionDetail || globalConfig.visionDetail || process.env.AURAXIS_VISION_DETAIL;
  const strictToolsValue =
    overrides.strictTools ??
    customModel?.strictTools ??
    projectConfig.strictTools ??
    globalConfig.strictTools ??
    process.env.AURAXIS_STRICT_TOOLS;

  const maxTokensValue =
    overrides.maxTokens ??
    customModel?.maxTokens ??
    projectConfig.maxTokens ??
    globalConfig.maxTokens ??
    builtInModel?.maxTokens;
  const maxIterationsValue = overrides.maxIterations ?? projectConfig.maxIterations ?? globalConfig.maxIterations;
  const contextBudgetValue =
    overrides.contextBudget ??
    projectConfig.contextBudget ??
    globalConfig.contextBudget ??
    customModel?.contextWindow ??
    process.env.AURAXIS_CONTEXT_BUDGET ??
    builtInModel?.contextWindow;
  const maxTokens =
    typeof maxTokensValue === 'number' && Number.isFinite(maxTokensValue)
      ? Math.max(1, Math.floor(maxTokensValue))
      : 32768;
  const maxIterations =
    typeof maxIterationsValue === 'number' && Number.isFinite(maxIterationsValue)
      ? Math.max(1, Math.floor(maxIterationsValue))
      : 200;
  const contextBudget =
    typeof contextBudgetValue === 'number' && Number.isFinite(contextBudgetValue)
      ? Math.max(1_000, Math.floor(contextBudgetValue))
      : Number.isFinite(Number(contextBudgetValue)) && Number(contextBudgetValue) > 0
        ? Math.max(1_000, Math.floor(Number(contextBudgetValue)))
        : 220_000;
  const customApiKey = customModel?.apiKeyEnv && process.env[customModel.apiKeyEnv];
  const supportsImages = customModel
    ? customModel.supportsImages
    : builtInModel && 'supportsImages' in builtInModel
      ? builtInModel.supportsImages
      : undefined;
  const providerApiKey =
    provider === 'anthropic'
      ? process.env.ANTHROPIC_API_KEY
      : provider === 'gemini'
        ? process.env.GEMINI_API_KEY
        : provider === 'openai'
          ? process.env.OPENAI_API_KEY
          : provider === 'ollama'
            ? process.env.OLLAMA_API_KEY
            : process.env.DEEPSEEK_API_KEY;

  return {
    projectRoot,
    model,
    provider,
    apiFamily,
    apiBase,
    headers: customModel?.headers,
    supportsImages,
    mode: isMode(modeValue) ? modeValue : normalizeMode(modeValue),
    sandboxMode: isSandbox(sandboxValue) ? sandboxValue : normalizeSandbox(sandboxValue),
    theme: typeof themeValue === 'string' ? themeValue : undefined,
    reasoningEffort: isEffort(effortValue) ? effortValue : normalizeEffort(effortValue),
    visionDetail: normalizeImageDetail(visionDetailValue),
    strictTools:
      strictToolsValue === undefined
        ? provider === 'deepseek' && apiFamily === 'chat'
        : toBoolean(strictToolsValue),
    maxTokens,
    maxIterations,
    contextBudget,
    toolChoice: normalizeToolChoice(toolChoiceValue),
    apiKey:
      overrides.apiKey ||
      process.env.AURAXIS_API_KEY ||
      customApiKey ||
      providerApiKey,
    customModels,
  };
}

export async function saveRuntimeConfig(config: Partial<Omit<RuntimeConfig, 'apiKey'>>): Promise<void> {
  const paths = getAppPaths();
  await fs.mkdir(paths.configDir, { recursive: true });
  const existing = await readJson(path.join(paths.configDir, 'config.json'));
  const next = { ...existing, ...config };
  await fs.writeFile(path.join(paths.configDir, 'config.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

function parseMcpServers(raw: unknown): McpServerConfig[] {
  const rawObject = asJsonObject(raw);
  const list = Array.isArray(raw) ? raw : Array.isArray(rawObject.servers) ? rawObject.servers : undefined;
  if (!Array.isArray(list)) return [];
  const servers: McpServerConfig[] = [];
  for (const item of list) {
    const parsed = mcpServerConfigSchema.safeParse(item);
    if (!parsed.success) continue;
    const value = parsed.data;
    servers.push({
      name: value.name,
      transport: value.transport ?? (value.url ? 'http' : 'stdio'),
      url: value.url,
      command: value.command || '',
      args: value.args,
      env: value.env,
      headers: value.headers,
    });
  }
  return servers;
}

export async function loadMcpServers(projectRoot = process.cwd()): Promise<McpServerConfig[]> {
  const paths = getAppPaths();
  const globalFile = await readJson(path.join(paths.configDir, 'mcp.json'));
  const trustProjectMcp = process.env.AURAXIS_TRUST_PROJECT_MCP === '1';
  const projectFile = trustProjectMcp ? await readJson(path.join(projectRoot, '.auraxis', 'mcp.json')) : {};
  const projectConfig = trustProjectMcp ? await readJson(path.join(projectRoot, '.auraxis.json')) : {};
  const plugins = await scanPlugins(projectRoot, process.env.AURAXIS_TRUST_PROJECT_HOOKS === '1');
  const all = [
    ...parseMcpServers(globalFile),
    ...parseMcpServers(projectFile),
    ...parseMcpServers(projectConfig.mcpServers),
    ...parseMcpServers({ servers: plugins.flatMap((plugin) => plugin.manifest.mcp || []) }),
  ];
  try {
    const envRaw = process.env.AURAXIS_MCP_SERVERS;
    if (envRaw) all.push(...parseMcpServers(parseJson(envRaw)));
  } catch {
    /* invalid env config ignored */
  }
  const map = new Map<string, McpServerConfig>();
  for (const server of all) map.set(server.name, server);
  return [...map.values()];
}
