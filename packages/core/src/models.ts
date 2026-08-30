import { DEEPSEEK_API_ORIGIN, DEFAULT_API_BASE, BUILT_IN_MODELS } from './config.js';
import type { ModelProvider } from './types.js';
import { asJsonObject, parseJson } from './validation.js';

export interface ModelChoice {
  id: string;
  name: string;
  provider: ModelProvider;
  experimental?: boolean;
}

export function modelsEndpoint(apiBase = DEFAULT_API_BASE): string {
  try {
    const origin = new URL(apiBase).origin;
    return `${origin}/models`;
  } catch {
    return `${DEEPSEEK_API_ORIGIN}/models`;
  }
}

export async function fetchLiveModels(
  apiKey: string,
  apiBase = DEFAULT_API_BASE,
  signal?: AbortSignal,
  provider: ModelProvider = 'deepseek',
): Promise<ModelChoice[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let response: Response;
  try {
    response = await fetch(modelsEndpoint(apiBase), {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  if (!response.ok) throw new Error(`模型列表请求失败（HTTP ${response.status}）`);
  const parsed = parseJson(await response.text());
  const root = asJsonObject(parsed);
  const rows = Array.isArray(root.data) ? root.data : [];
  return rows
    .map((item) => asJsonObject(item))
    .filter((item) => typeof item.id === 'string' && item.id)
    .map((item) => ({
      id: String(item.id),
      name: typeof item.name === 'string' && item.name ? item.name : String(item.id),
      provider,
      experimental: item.experimental === true,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function resolveModelChoices(
  apiKey: string,
  apiBase = DEFAULT_API_BASE,
  signal?: AbortSignal,
  provider: ModelProvider = 'deepseek',
): Promise<{ source: 'live' | 'builtin'; models: ModelChoice[] }> {
  try {
    const live = await fetchLiveModels(apiKey, apiBase, signal, provider);
    if (live.length > 0) return { source: 'live', models: live };
  } catch {
    // 网络或 API 不可用时退回内置模型列表。
  }
  return {
    source: 'builtin',
    models: BUILT_IN_MODELS.map((item) => ({
      id: item.id,
      name: item.name,
      provider: 'deepseek',
      experimental: 'experimental' in item ? item.experimental : undefined,
    })),
  };
}
