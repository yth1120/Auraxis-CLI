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
});
