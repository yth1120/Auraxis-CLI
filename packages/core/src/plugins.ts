import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import type { McpServerConfig } from './types.js';
import type { HookConfig } from './hooks.js';
import { parseJson, pluginManifestSchema } from './validation.js';

export interface PluginManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  skills?: string[];
  hooks?: Partial<Record<string, HookConfig | HookConfig[]>>;
  mcp?: McpServerConfig[];
}

export interface PluginRecord {
  manifest: PluginManifest;
  root: string;
}

async function readManifest(dir: string): Promise<PluginManifest | null> {
  const file = path.join(dir, 'plugin.json');
  try {
    const raw = await fsp.readFile(file, 'utf8');
    const parsed = pluginManifestSchema.safeParse(parseJson(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function scanDir(dir: string): Promise<PluginRecord[]> {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const plugins: PluginRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = path.join(dir, entry.name);
    const manifest = await readManifest(root);
    if (manifest) plugins.push({ manifest, root });
  }
  return plugins;
}

export async function scanPlugins(projectRoot: string, trustProject = false): Promise<PluginRecord[]> {
  const home = process.env.AURAXIS_HOME || path.join(os.homedir(), '.auraxis');
  const roots = [
    path.join(home, 'plugins'),
    path.join(projectRoot, '.auraxis', 'plugins'),
  ];
  const all: PluginRecord[] = [];
  for (let index = 0; index < roots.length; index += 1) {
    if (index === 1 && !trustProject) continue;
    all.push(...(await scanDir(roots[index])));
  }
  return all;
}

export async function installPlugin(source: string, projectRoot: string): Promise<PluginRecord> {
  const resolved = path.resolve(source);
  const sourceManifest = await readManifest(resolved);
  if (!sourceManifest) throw new Error(`源目录缺少 plugin.json: ${resolved}`);
  const target = path.join(projectRoot, '.auraxis', 'plugins', sourceManifest.id);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.cp(resolved, target, { recursive: true, force: true });
  return { manifest: sourceManifest, root: target };
}

export async function discoverMarketplace(): Promise<PluginManifest[]> {
  const file = process.env.AURAXIS_PLUGIN_MARKETPLACE;
  if (!file) return [];
  const raw = file.startsWith('http://') || file.startsWith('https://')
    ? await (await fetch(file)).text()
    : await fsp.readFile(file, 'utf8');
  const value = parseJson(raw);
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = pluginManifestSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
