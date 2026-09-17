import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRuntimeConfig, saveRuntimeConfig } from '../config.js';

let dataDir = '';

afterEach(async () => {
  delete process.env.AURAXIS_HOME;
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
});

describe('runtime config', () => {
  it('persists theme and token settings', async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-config-'));
    process.env.AURAXIS_HOME = dataDir;
    await saveRuntimeConfig({ theme: 'neon', maxTokens: 1234 });
    const config = await loadRuntimeConfig();
    expect(config.theme).toBe('neon');
    expect(config.maxTokens).toBe(1234);
  });

  it('resolves apiBase from custom models registered in config', async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-config-custom-'));
    process.env.AURAXIS_HOME = dataDir;
    const configDir = path.join(dataDir, 'config');
    await fs.mkdir(configDir, { recursive: true });
    await saveRuntimeConfig({
      customModels: [
        { id: 'my-gateway', name: 'My Gateway', apiBase: 'https://gw.example.com/v1/chat/completions' },
      ],
    });
    const config = await loadRuntimeConfig({ model: 'my-gateway' });
    expect(config.apiBase).toBe('https://gw.example.com/v1/chat/completions');
    expect(config.customModels[0]).toMatchObject({ id: 'my-gateway', name: 'My Gateway' });
  });

  it('resolves provider and context budget from overrides', async () => {
    const config = await loadRuntimeConfig({ provider: 'anthropic', contextBudget: 12_000 });
    expect(config.provider).toBe('anthropic');
    expect(config.contextBudget).toBe(12_000);
    expect(config.apiBase).toBe('https://api.anthropic.com/v1/messages');
  });

  it('defaults to deepseek-flash with the official OpenAI-compatible base URL', async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-defaults-'));
    process.env.AURAXIS_HOME = dataDir;
    const config = await loadRuntimeConfig();
    expect(config.model).toBe('deepseek-flash');
    expect(config.apiBase).toBe('https://api.deepseek.com/chat/completions');
    expect(config.apiFamily).toBe('chat');
    expect(config.maxTokens).toBe(384_000);
    expect(config.contextBudget).toBe(1_000_000);
    // 官方文档：思考模式默认开启，默认强度 high。
    expect(config.thinking).toBe(true);
    expect(config.reasoningEffort).toBe('high');
  });

  it('reads the thinking toggle from overrides and environment', async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-thinking-'));
    process.env.AURAXIS_HOME = dataDir;
    await saveRuntimeConfig({ thinking: false });
    expect((await loadRuntimeConfig()).thinking).toBe(false);
    expect((await loadRuntimeConfig({ thinking: true })).thinking).toBe(true);
    delete process.env.AURAXIS_HOME;
    process.env.AURAXIS_THINKING = 'off';
    expect((await loadRuntimeConfig()).thinking).toBe(false);
    delete process.env.AURAXIS_THINKING;
  });
});
