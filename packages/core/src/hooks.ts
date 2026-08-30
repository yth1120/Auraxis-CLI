import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { getAppPaths } from './config.js';
import { scanPlugins } from './plugins.js';
import { safeProcessEnv } from './safe-env.js';
import { hookConfigSchema, hookProtocolSchema, hooksFileSchema, parseJson } from './validation.js';

export type HookEvent = 'session_start' | 'user_prompt_submit' | 'pre_tool_use' | 'post_tool_use' | 'stop' | 'session_end';

export interface HookConfig {
  command: string;
  timeout?: number;
}

export interface HookProtocol {
  decision?: 'allow' | 'block';
  continue?: boolean;
  stopReason?: string;
  additionalContext?: string;
}

export interface HookResult {
  ok: boolean;
  output: string;
  code: number | null;
  timedOut: boolean;
  protocol?: HookProtocol;
}

export interface HooksDispatch {
  blocked: boolean;
  outputs: string[];
  stopReason?: string;
  additionalContext?: string;
}

function hookEnv(payload: Record<string, unknown>): NodeJS.ProcessEnv {
  const env = safeProcessEnv();
  env.HOOK_PAYLOAD = JSON.stringify(payload);
  return env;
}

function killHookProcess(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      if (settled) return;
      settled = true;
      if (fallback) clearTimeout(fallback);
      resolve();
    };
    if (child.exitCode !== null) {
      done();
      return;
    }
    fallback = setTimeout(done, 2_000);
    child.once('close', done);
    if (!child.pid) {
      child.kill();
      return;
    }
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      killer.on('close', () => {
        if (child.exitCode === null) child.kill();
      });
      killer.on('error', () => child.kill());
      return;
    }
    child.kill('SIGKILL');
  });
}

async function readHooksFile(file: string): Promise<Partial<Record<HookEvent, HookConfig[]>> | null> {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    const parsed = hooksFileSchema.safeParse(parseJson(raw));
    if (!parsed.success || !parsed.data.hooks) return {};
    const out: Partial<Record<HookEvent, HookConfig[]>> = {};
    for (const [key, value] of Object.entries(parsed.data.hooks)) {
      if (!value) continue;
      const configs = Array.isArray(value) ? value : [value];
      const valid = configs.flatMap((item) => {
        const parsedHook = hookConfigSchema.safeParse(item);
        return parsedHook.success ? [parsedHook.data] : [];
      });
      if (valid.length) out[key as HookEvent] = valid;
    }
    return out;
  } catch {
    return null;
  }
}

export async function loadHooks(projectRoot?: string): Promise<Partial<Record<HookEvent, HookConfig[]>>> {
  const merged: Partial<Record<HookEvent, HookConfig[]>> = {};
  const user = await readHooksFile(path.join(getAppPaths().configDir, 'hooks.json'));
  const trustProject = process.env.AURAXIS_TRUST_PROJECT_HOOKS === '1';
  const project = projectRoot && trustProject ? await readHooksFile(path.join(projectRoot, '.auraxis', 'hooks.json')) : null;
  for (const layer of [user, project]) {
    if (!layer) continue;
    for (const [event, hooks] of Object.entries(layer)) {
      if (hooks) merged[event as HookEvent] = [...(merged[event as HookEvent] || []), ...hooks];
    }
  }
  for (const plugin of await scanPlugins(projectRoot || process.cwd(), trustProject)) {
    for (const [event, value] of Object.entries(plugin.manifest.hooks || {})) {
      if (!value) continue;
      const configs = (Array.isArray(value) ? value : [value]).filter(
        (item): item is HookConfig => hookConfigSchema.safeParse(item).success,
      );
      if (configs.length) merged[event as HookEvent] = [...(merged[event as HookEvent] || []), ...configs];
    }
  }
  return merged;
}

export function runHook(config: HookConfig, payload: Record<string, unknown>, cwd: string): Promise<HookResult> {
  return new Promise((resolve) => {
    const child = spawn(config.command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: hookEnv(payload),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const timeoutMs = config.timeout && config.timeout > 0 ? config.timeout : 10_000;
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(async () => {
      if (settled) return;
      settled = true;
      await killHookProcess(child);
      resolve({ ok: false, output: (stdout + stderr).trim(), code: null, timedOut: true });
    }, timeoutMs);
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      let protocol: HookProtocol | undefined;
      try {
        const parsed = hookProtocolSchema.safeParse(parseJson(stdout.trim()));
        if (parsed.success) {
          protocol = parsed.data;
        }
      } catch {
        /* plain-text hook output */
      }
      resolve({ ok: code === 0, output, code, timedOut: false, ...(protocol ? { protocol } : {}) });
    };
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', (_error) => finish(null));
    child.on('close', (code) => finish(code));
    child.stdin.on('error', () => {});
    try {
      child.stdin.end(JSON.stringify(payload));
    } catch {
      /* stdin closed */
    }
  });
}

export async function runHooksFor(
  event: HookEvent,
  payload: Record<string, unknown>,
  projectRoot: string,
  hooks: Partial<Record<HookEvent, HookConfig[]>>,
): Promise<HooksDispatch> {
  const dispatch: HooksDispatch = { blocked: false, outputs: [] };
  for (const config of hooks[event] || []) {
    const result = await runHook(config, payload, projectRoot);
    if (result.output) dispatch.outputs.push(result.output);
    const protocol = result.protocol;
    if (protocol?.additionalContext) dispatch.additionalContext = protocol.additionalContext;
    if (!dispatch.stopReason && protocol?.stopReason) dispatch.stopReason = protocol.stopReason;
    if (event === 'pre_tool_use' && (protocol?.decision === 'block' || !result.ok)) dispatch.blocked = true;
    if (event === 'user_prompt_submit' && protocol?.continue === false) dispatch.blocked = true;
  }
  return dispatch;
}
