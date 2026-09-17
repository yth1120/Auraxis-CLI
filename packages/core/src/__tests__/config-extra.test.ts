import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMcpServers, loadRuntimeConfig, saveRuntimeConfig } from '../config.js';

let home = '';
let project = '';

afterEach(async () => {
  delete process.env.AURAXIS_HOME;
  delete process.env.AURAXIS_MCP_SERVERS;
  delete process.env.AURAXIS_MODE;
  delete process.env.AURAXIS_SANDBOX;
  delete process.env.AURAXIS_ALLOW_UNSAFE_CODE;
  delete process.env.AURAXIS_TRUST_PROJECT_MCP;
  delete process.env.AURAXIS_TRUST_PROJECT_HOOKS;
  if (home) await fs.rm(home, { recursive: true, force: true });
  if (project) await fs.rm(project, { recursive: true, force: true });
});

async function setup(): Promise<{ home: string; project: string }> {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-config-extra-'));
  project = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-project-extra-'));
  process.env.AURAXIS_HOME = home;
  return { home, project };
}

describe('runtime config extras', () => {
  it('reads dotenv and normalizes invalid modes', async () => {
    const { project } = await setup();
    await fs.writeFile(path.join(project, '.env'), 'AURAXIS_MODE=auto\nAURAXIS_SANDBOX=read\n', 'utf8');
    const config = await loadRuntimeConfig({ project });
    expect(config.mode).toBe('auto');
    expect(config.sandboxMode).toBe('read');
  });

  it('loads MCP servers from global, project, config and environment', async () => {
    const { home, project } = await setup();
    const configDir = path.join(home, 'config');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'mcp.json'),
      JSON.stringify({ servers: [{ name: 'global', command: 'node' }] }),
      'utf8',
    );
    await fs.mkdir(path.join(project, '.auraxis'), { recursive: true });
    await fs.writeFile(
      path.join(project, '.auraxis', 'mcp.json'),
      JSON.stringify({ servers: [{ name: 'project', command: 'node', args: ['--version'] }] }),
      'utf8',
    );
    await fs.writeFile(
      path.join(project, '.auraxis.json'),
      JSON.stringify({ mcpServers: [{ name: 'inline', url: 'https://example.test/mcp' }] }),
      'utf8',
    );
    process.env.AURAXIS_MCP_SERVERS = JSON.stringify([{ name: 'env', command: 'node' }]);
    process.env.AURAXIS_TRUST_PROJECT_MCP = '1';
    const servers = await loadMcpServers(project);
    expect(servers.map((server) => server.name)).toEqual(expect.arrayContaining(['global', 'project', 'inline', 'env']));

    process.env.AURAXIS_MCP_SERVERS = JSON.stringify({ servers: [{ name: 'env-object', command: 'node' }, { name: 'bad' }] });
    expect((await loadMcpServers(project)).map((server) => server.name)).toContain('env-object');

    process.env.AURAXIS_MCP_SERVERS = 'not-json';
    expect(await loadMcpServers(project)).toHaveLength(3);
  });

  it('does not load project MCP servers unless explicitly trusted', async () => {
    const { home, project } = await setup();
    const configDir = path.join(home, 'config');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, 'mcp.json'),
      JSON.stringify({ servers: [{ name: 'global', command: 'node' }] }),
      'utf8',
    );
    await fs.mkdir(path.join(project, '.auraxis'), { recursive: true });
    await fs.writeFile(
      path.join(project, '.auraxis', 'mcp.json'),
      JSON.stringify({ servers: [{ name: 'project', command: 'node', args: ['--version'] }] }),
      'utf8',
    );
    const servers = await loadMcpServers(project);
    expect(servers.map((server) => server.name)).toEqual(['global']);
  });

  it('ignores project-provided security switches', async () => {
    const { home, project } = await setup();
    await fs.writeFile(
      path.join(project, '.env'),
      [
        'AURAXIS_ALLOW_UNSAFE_CODE=1',
        'AURAXIS_TRUST_PROJECT_MCP=1',
        'AURAXIS_TRUST_PROJECT_HOOKS=1',
        `AURAXIS_HOME=${path.join(home, 'evil')}`,
        'AURAXIS_MCP_SERVERS=not-json',
      ].join('\n'),
      'utf8',
    );
    await loadRuntimeConfig({ project });
    expect(process.env.AURAXIS_ALLOW_UNSAFE_CODE).toBeUndefined();
    expect(process.env.AURAXIS_TRUST_PROJECT_MCP).toBeUndefined();
    expect(process.env.AURAXIS_TRUST_PROJECT_HOOKS).toBeUndefined();
    expect(process.env.AURAXIS_HOME).toBe(home);
    expect(process.env.AURAXIS_MCP_SERVERS).toBeUndefined();
  });

  it('merges saved custom models and preserves headers', async () => {
    await setup();
    await saveRuntimeConfig({
      customModels: [
        {
          id: 'local',
          name: 'Local',
          provider: 'ollama',
          apiBase: 'http://localhost:11434/v1',
          headers: { 'x-token': 'v' },
          maxTokens: 1234,
          strictTools: false,
          contextWindow: 50_000,
          supportsImages: true,
        },
      ],
    });
    const config = await loadRuntimeConfig({ model: 'local' });
    expect(config.provider).toBe('ollama');
    expect(config.customModels[0]?.headers?.['x-token']).toBe('v');
    expect(config.headers?.['x-token']).toBe('v');
    expect(config.maxTokens).toBe(1234);
    expect(config.strictTools).toBe(false);
    expect(config.contextBudget).toBe(50_000);
    expect(config.supportsImages).toBe(true);
  });

  it('resolves custom API keys from the configured environment variable', async () => {
    await setup();
    process.env.AURAXIS_TEST_PROVIDER_KEY = 'sk-provider';
    await saveRuntimeConfig({
      customModels: [
        { id: 'gateway', name: 'Gateway', apiKeyEnv: 'AURAXIS_TEST_PROVIDER_KEY' },
      ],
    });
    const config = await loadRuntimeConfig({ model: 'gateway' });
    expect(config.apiKey).toBe('sk-provider');
    delete process.env.AURAXIS_TEST_PROVIDER_KEY;
  });

  it('prefers the API key matching the selected provider', async () => {
    await setup();
    process.env.ANTHROPIC_API_KEY = 'ant-key';
    process.env.DEEPSEEK_API_KEY = 'ds-key';
    const anthropic = await loadRuntimeConfig({ provider: 'anthropic' });
    expect(anthropic.apiKey).toBe('ant-key');
    const deepseek = await loadRuntimeConfig({ provider: 'deepseek' });
    expect(deepseek.apiKey).toBe('ds-key');
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
  });

  it('normalizes invalid runtime values and resolves provider bases', async () => {
    await setup();
    const invalid = await loadRuntimeConfig({
      mode: 'bad',
      sandbox: 'bad',
      reasoningEffort: 'bad',
      toolChoice: 'bad',
      maxTokens: -5,
      maxSteps: -1,
      contextBudget: '12000' as never,
    });
    expect(invalid.mode).toBe('ask');
    expect(invalid.sandboxMode).toBe('workspace-write');
    expect(invalid.reasoningEffort).toBe('high');
      expect(invalid.toolChoice).toBe('auto');
      expect(invalid.maxTokens).toBe(1);
      expect(invalid.maxSteps).toBe(-1);
      expect(invalid.maxIterations).toBe(-1);
      expect(invalid.contextBudget).toBe(12_000);

      const legacy = await loadRuntimeConfig({ maxIterations: 25 });
      expect(legacy.maxSteps).toBe(25);

    expect((await loadRuntimeConfig({ provider: 'gemini' })).apiBase).toContain('generativelanguage');
    expect((await loadRuntimeConfig({ provider: 'ollama' })).apiBase).toContain('11434');
    expect((await loadRuntimeConfig({ provider: 'custom' })).apiBase).toContain('deepseek');
  });

  it('exposes only reasoning effort and defaults thinking intensity', async () => {
    await setup();
    const config = await loadRuntimeConfig({ provider: 'deepseek' });
    expect(config.reasoningEffort).toBe('high');
    expect('deepThink' in config).toBe(false);
  });

  it('loads plugin MCP servers and quoted dotenv values', async () => {
    const { home, project } = await setup();
    const pluginRoot = path.join(home, 'plugins', 'p');
    await fs.mkdir(pluginRoot, { recursive: true });
    await fs.writeFile(
      path.join(pluginRoot, 'plugin.json'),
      JSON.stringify({
        id: 'p',
        name: 'P',
        mcp: [{ name: 'plugin-mcp', command: 'node', args: ['--version'] }],
      }),
      'utf8',
    );
    await fs.writeFile(path.join(project, '.env'), 'AURAXIS_MODE="plan"\n', 'utf8');
    const servers = await loadMcpServers(project);
    expect(servers.map((server) => server.name)).toContain('plugin-mcp');
    expect((await loadRuntimeConfig({ project })).mode).toBe('plan');
  });

});
