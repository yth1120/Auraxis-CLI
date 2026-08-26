import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ApprovalPolicy, McpServerConfig, ReasoningEffort, SandboxMode, ToolChoice } from './types.js';

export const DEFAULT_API_BASE = 'https://api.deepseek.com/beta/chat/completions';

export const BUILT_IN_MODELS = [
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', maxTokens: 384000, contextWindow: 1_000_000 },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', maxTokens: 384000, contextWindow: 1_000_000 },
  {
    id: 'deepseek-v4-flash-vision-exp',
    name: 'DeepSeek V4 Flash Vision Exp',
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
  apiKey?: string;
  apiBase: string;
  mode: ApprovalPolicy;
  sandboxMode: SandboxMode;
  deepThink: boolean;
  reasoningEffort: ReasoningEffort;
  maxTokens: number;
  maxIterations: number;
  toolChoice: ToolChoice;
}

export interface ConfigOverrides {
  project?: string;
  model?: string;
  apiKey?: string;
  apiBase?: string;
  mode?: string;
  sandbox?: string;
  deepThink?: boolean;
  reasoningEffort?: string;
  maxTokens?: number;
  maxIterations?: number;
  toolChoice?: string;
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
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
  if (value === 'read' || value === 'full') return value;
  return 'workspace-write';
}

function normalizeEffort(value: unknown): ReasoningEffort {
  if (value === 'low' || value === 'high' || value === 'max') return value;
  return 'high';
}

function normalizeToolChoice(value: unknown): ToolChoice {
  if (value === 'auto' || value === 'none' || value === 'required') return value;
  return 'auto';
}

function isMode(value: unknown): value is ApprovalPolicy {
  return value === 'ask' || value === 'plan' || value === 'auto';
}

function isSandbox(value: unknown): value is SandboxMode {
  return value === 'read' || value === 'workspace-write' || value === 'full';
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

  const model =
    overrides.model ||
    (typeof globalConfig.model === 'string' && globalConfig.model) ||
    (typeof projectConfig.model === 'string' && projectConfig.model) ||
    process.env.AURAXIS_MODEL ||
    'deepseek-v4-pro';

  const apiBase =
    overrides.apiBase ||
    process.env.AURAXIS_API_BASE ||
    process.env.DEEPSEEK_BASE_URL ||
    (typeof globalConfig.apiBase === 'string' && globalConfig.apiBase) ||
    (typeof projectConfig.apiBase === 'string' && projectConfig.apiBase) ||
    DEFAULT_API_BASE;

  const modeValue = overrides.mode || projectConfig.permissionMode || globalConfig.permissionMode || process.env.AURAXIS_MODE;
  const sandboxValue = overrides.sandbox || projectConfig.sandboxMode || globalConfig.sandboxMode || process.env.AURAXIS_SANDBOX;
  const effortValue =
    overrides.reasoningEffort || projectConfig.reasoningEffort || globalConfig.reasoningEffort || process.env.AURAXIS_REASONING_EFFORT;
  const toolChoiceValue = overrides.toolChoice || projectConfig.toolChoice || globalConfig.toolChoice || process.env.AURAXIS_TOOL_CHOICE;

  const maxTokens = overrides.maxTokens ?? 32768;
  const maxIterations = overrides.maxIterations ?? 200;

  return {
    projectRoot,
    model,
    apiBase,
    mode: isMode(modeValue) ? modeValue : normalizeMode(modeValue),
    sandboxMode: isSandbox(sandboxValue) ? sandboxValue : normalizeSandbox(sandboxValue),
    deepThink: Boolean(overrides.deepThink ?? projectConfig.deepThink ?? globalConfig.deepThink ?? process.env.AURAXIS_DEEP_THINK === '1'),
    reasoningEffort: isEffort(effortValue) ? effortValue : normalizeEffort(effortValue),
    maxTokens,
    maxIterations,
    toolChoice: normalizeToolChoice(toolChoiceValue),
    apiKey: overrides.apiKey || process.env.AURAXIS_API_KEY || process.env.DEEPSEEK_API_KEY,
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
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? (raw as Record<string, unknown>).servers : undefined;
  if (!Array.isArray(list)) return [];
  const servers: McpServerConfig[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    if (typeof value.name !== 'string' || typeof value.command !== 'string') continue;
    servers.push({
      name: value.name,
      command: value.command,
      args: Array.isArray(value.args) ? value.args.filter((arg): arg is string => typeof arg === 'string') : undefined,
      env:
        value.env && typeof value.env === 'object'
          ? Object.fromEntries(
              Object.entries(value.env as Record<string, unknown>).filter(([, v]) => typeof v === 'string'),
            ) as Record<string, string>
          : undefined,
    });
  }
  return servers;
}

export async function loadMcpServers(projectRoot = process.cwd()): Promise<McpServerConfig[]> {
  const paths = getAppPaths();
  const globalFile = await readJson(path.join(paths.configDir, 'mcp.json'));
  const projectFile = await readJson(path.join(projectRoot, '.auraxis', 'mcp.json'));
  const projectConfig = await readJson(path.join(projectRoot, '.auraxis.json'));
  const all = [
    ...parseMcpServers(globalFile),
    ...parseMcpServers(projectFile),
    ...parseMcpServers(projectConfig.mcpServers),
  ];
  try {
    const envRaw = process.env.AURAXIS_MCP_SERVERS;
    if (envRaw) all.push(...parseMcpServers(JSON.parse(envRaw)));
  } catch {
    /* invalid env config ignored */
  }
  const map = new Map<string, McpServerConfig>();
  for (const server of all) map.set(server.name, server);
  return [...map.values()];
}

export function configIsMode(value: unknown): value is ApprovalPolicy {
  return value === 'ask' || value === 'plan' || value === 'auto';
}

export function configIsSandbox(value: unknown): value is SandboxMode {
  return value === 'read' || value === 'workspace-write' || value === 'full';
}
