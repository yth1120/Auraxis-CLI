import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getTool,
  getTools,
  isToolConcurrencySafe,
  isToolReadOnly,
  summarizeToolInput,
  TOOL_RUNNERS,
  type ToolContext,
} from '../tools/registry.js';

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    projectRoot: '/project',
    emit: () => {},
    todos: [],
    setTodos: () => {},
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.AURAXIS_REMOTE_API;
  delete process.env.AURAXIS_REMOTE_TOKEN;
  vi.unstubAllGlobals();
});

describe('tool registry helpers', () => {
  it('finds tools and summarises inputs', () => {
    expect(getTool('Read')?.definition.name).toBe('Read');
    expect(getTool('missing')).toBeUndefined();
    expect(isToolConcurrencySafe('Read')).toBe(true);
    expect(isToolConcurrencySafe('Write')).toBe(false);
    expect(isToolReadOnly('Read')).toBe(true);
    expect(isToolReadOnly('Bash')).toBe(false);
    expect(summarizeToolInput('Read', { file_path: 'a.ts' })).toBe('a.ts');
    expect(summarizeToolInput('unknown', { a: 'hello' })).toBe('hello');
    expect(summarizeToolInput('unknown', {})).toBe('');
    expect(getTools().length).toBeGreaterThan(10);
  });

  it('handles runtime inspection, ask, agents and tasks', async () => {
    await expect(TOOL_RUNNERS.get('InspectRuntime')!({}, context({ tools: [] }))).resolves.toMatchObject({ content: expect.stringContaining('tools') });
    expect((await TOOL_RUNNERS.get('AskUser')!({ question: 'q' }, context({ askUser: async () => 'answer' }))).content).toBe('answer');
    expect((await TOOL_RUNNERS.get('AskUser')!({}, context())).content).toContain('缺少');
    expect((await TOOL_RUNNERS.get('Agent')!({ prompt: 'x' }, context())).content).toContain('不支持');
    expect((await TOOL_RUNNERS.get('Agent')!({ prompt: 'x' }, context({ runSubAgent: async () => 'ok' }))).content).toBe('ok');
    expect((await TOOL_RUNNERS.get('SpawnAgents')!({ tasks: 'bad' }, context())).content).toContain('数组');
    expect((await TOOL_RUNNERS.get('SpawnAgents')!({ tasks: [] }, context())).content).toContain('缺少');
    expect((await TOOL_RUNNERS.get('SpawnAgents')!({ tasks: ['bad', { prompt: 'x' }] }, context({ runSubAgents: async () => ['x'] }))).content).toContain('[1] x');
  });

  it('handles memory, skills, symbol and plugin flows', async () => {
    const memory = {
      remember: async (title: string, content: string) => ({ id: 'm1', title, content, tags: [], updatedAt: 1 }),
      search: async () => [{ id: 'm1', title: 'T', content: 'C', tags: ['x'], updatedAt: 1 }],
    } as never;
    expect((await TOOL_RUNNERS.get('MemoryRemember')!({ title: 'T', content: 'C' }, context({ memory }))).content).toContain('m1');
    expect((await TOOL_RUNNERS.get('MemorySearch')!({ query: 'T' }, context({ memory }))).content).toContain('T');
    expect((await TOOL_RUNNERS.get('FindSymbol')!({}, context())).content).toContain('需要');
    expect((await TOOL_RUNNERS.get('ListSkills')!({}, context({ listSkills: async () => [] }))).content).toContain('暂无');
    expect((await TOOL_RUNNERS.get('ReadSkill')!({}, context())).content).toContain('未找到技能');
    expect((await TOOL_RUNNERS.get('PluginManage')!({ action: 'list' }, context())).content).toContain('暂无');
    expect((await TOOL_RUNNERS.get('PluginManage')!({ action: 'discover' }, context())).content).toContain('未配置 AURAXIS_PLUGIN_MARKETPLACE');
  });

  it('handles messaging, artifacts, undo and remote agent errors', async () => {
    const mailbox = {
      send: async (_from: string, to: string, text: string) => ({ id: 'x', from: 'a', to, text, createdAt: 1 }),
      list: async () => [{ id: 'x', from: 'a', to: 'b', text: 'hello', createdAt: 1 }],
    } as never;
    expect((await TOOL_RUNNERS.get('SendMessage')!({ to: 'b', message: 'hi' }, context({ mailbox }))).content).toContain('已发送');
    expect((await TOOL_RUNNERS.get('ReadMessages')!({}, context({ mailbox, sessionId: 'b' }))).content).toContain('hello');
    expect((await TOOL_RUNNERS.get('SendMessage')!({}, context())).content).toContain('需要');

    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-runners-'));
    try {
      expect((await TOOL_RUNNERS.get('PublishArtifact')!({ title: 'T', content: 'C' }, context({ projectRoot: root }))).content).toContain('已发布');
      expect((await TOOL_RUNNERS.get('ListArtifacts')!({}, context({ projectRoot: root }))).content).toContain('.md');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
    expect((await TOOL_RUNNERS.get('RemoteAgent')!({ prompt: 'x' }, context())).content).toContain('未配置');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: 'remote ok' }), { status: 200 }));
    process.env.AURAXIS_REMOTE_API = 'https://example.test/agent';
    vi.stubGlobal('fetch', fetchMock);
    expect((await TOOL_RUNNERS.get('RemoteAgent')!({ prompt: 'x' }, context())).content).toBe('remote ok');
  });

  it('covers remaining decision branches', async () => {
    const memory = {
      remember: async (title: string, content: string) => ({ id: 'm2', title, content, tags: [], updatedAt: 1 }),
      search: async () => [],
    } as never;
    expect((await TOOL_RUNNERS.get('MemoryRemember')!({}, context())).content).toContain('需要');
    expect((await TOOL_RUNNERS.get('MemoryRemember')!({ title: 'T', content: 'C' }, context())).content).toContain('未启用');
    expect((await TOOL_RUNNERS.get('MemoryRemember')!({ title: 'T', content: 'C', tags: ['x'] }, context({ memory }))).content).toContain('m2');
    expect((await TOOL_RUNNERS.get('MemorySearch')!({}, context())).content).toContain('未启用');
    expect((await TOOL_RUNNERS.get('MemorySearch')!({ query: 'none' }, context({ memory }))).content).toContain('未找到');
    expect((await TOOL_RUNNERS.get('SpawnAgents')!({ tasks: [{ prompt: 'x' }] }, context())).content).toContain('不支持');
    expect((await TOOL_RUNNERS.get('SpawnAgents')!({ tasks: [{ prompt: 'x' }] }, context({ runSubAgents: async () => ['a', 'b'] }))).content).toContain('[1] a');
    expect((await TOOL_RUNNERS.get('ReadMessages')!({}, context())).content).toContain('未启用');
    expect((await TOOL_RUNNERS.get('ReadMessages')!({}, context({ mailbox: { list: async () => [] } as never }))).content).toContain('暂无');
    expect((await TOOL_RUNNERS.get('PublishArtifact')!({}, context())).content).toContain('需要');
    expect((await TOOL_RUNNERS.get('ListArtifacts')!({}, context({ projectRoot: '/empty' }))).content).toContain('暂无');
    expect((await TOOL_RUNNERS.get('Undo')!({}, context())).content).toContain('撤销不可用');
    expect((await TOOL_RUNNERS.get('Undo')!({}, context({ undo: { revertLatest: async () => null } as never }))).content).toContain('没有可撤销');
    expect((await TOOL_RUNNERS.get('Undo')!({}, context({ undo: { revertLatest: async () => ({ file: '/project/a.ts', content: 'c', ts: 1 }) } as never }))).content).toContain('a.ts');
    expect((await TOOL_RUNNERS.get('ListSkills')!({}, context({ listSkills: async () => [{ id: 's', name: 'S', description: 'd', root: '/x', manifest: {} }] as never }))).content).toContain('s');
    expect((await TOOL_RUNNERS.get('ReadSkill')!({ skill_id: 's' }, context({ readSkill: async () => '' }))).content).toContain('未找到');
    expect((await TOOL_RUNNERS.get('ReadSkill')!({ skill_id: 's' }, context({ readSkill: async () => 'content' }))).content).toBe('content');
  });

  it('covers plugin, lsp, remote and summary branches', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-runners-extra-'));
    try {
      expect((await TOOL_RUNNERS.get('PluginManage')!({ action: 'install' }, context())).content).toContain('install 需要');
      const pluginDir = path.join(root, 'plugin');
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(path.join(pluginDir, 'plugin.json'), JSON.stringify({ id: 'p', name: 'P' }), 'utf8');
      expect((await TOOL_RUNNERS.get('PluginManage')!({ action: 'install', source: pluginDir }, context({ projectRoot: root }))).content).toContain('已安装');
      expect((await TOOL_RUNNERS.get('PluginManage')!({}, context())).content).toContain('暂无插件');
      process.env.AURAXIS_PLUGIN_MARKETPLACE = 'not-a-file';
      await expect(TOOL_RUNNERS.get('PluginManage')!({ action: 'discover' }, context())).rejects.toThrow();
    } finally {
      delete process.env.AURAXIS_PLUGIN_MARKETPLACE;
    }

    const fakeLsp = { definition: async () => ({ uri: 'x' }), references: async () => [{ uri: 'y' }] } as never;
    const file = path.join(root, 'a.ts');
    await fs.writeFile(file, 'const a = 1;', 'utf8');
    expect((await TOOL_RUNNERS.get('LspDefinition')!({ file_path: 'a.ts' }, context({ lsp: fakeLsp }))).content).toContain('uri');
    await expect(TOOL_RUNNERS.get('LspDefinition')!({ file_path: '../outside.ts' }, context({ lsp: fakeLsp }))).rejects.toThrow();
    expect((await TOOL_RUNNERS.get('LspReferences')!({ file_path: 'a.ts' }, context({ lsp: fakeLsp }))).content).toContain('y');
    expect((await TOOL_RUNNERS.get('LspReferences')!({ file_path: 'a.ts' }, context())).content).toContain('未配置');
    expect((await TOOL_RUNNERS.get('RemoteAgent')!({}, context())).content).toContain('缺少');
    await fs.rm(root, { recursive: true, force: true });
  });

  it('handles marketplace discovery and empty remote responses', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-runners-market-'));
    try {
      const marketplace = path.join(root, 'market.json');
      await fs.writeFile(marketplace, JSON.stringify([{ id: 'm', name: 'M', version: '1' }]), 'utf8');
      process.env.AURAXIS_PLUGIN_MARKETPLACE = marketplace;
      expect((await TOOL_RUNNERS.get('PluginManage')!({ action: 'discover' }, context())).content).toContain('m');
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
      process.env.AURAXIS_REMOTE_API = 'https://example.test/agent';
      expect((await TOOL_RUNNERS.get('RemoteAgent')!({ prompt: 'x' }, context())).content).toContain('未返回内容');
    } finally {
      delete process.env.AURAXIS_PLUGIN_MARKETPLACE;
      delete process.env.AURAXIS_REMOTE_API;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('covers fallback definitions, remote errors and summary forms', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-runners-fallback-'));
    try {
      await fs.writeFile(path.join(root, 'a.ts'), 'function a() {}', 'utf8');
      expect((await TOOL_RUNNERS.get('LspDefinition')!({ file_path: 'a.ts' }, context({ projectRoot: root }))).content).toContain('a');
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 500 }));
      process.env.AURAXIS_REMOTE_API = 'https://example.test/agent';
      process.env.AURAXIS_REMOTE_TOKEN = 'token';
      vi.stubGlobal('fetch', fetchMock);
      await expect(TOOL_RUNNERS.get('RemoteAgent')!({ prompt: 'x' }, context({ projectRoot: root }))).rejects.toThrow('500');
      expect(summarizeToolInput('Bash', { command: 'echo a && echo b' })).toBe('echo a && echo b');
      expect(summarizeToolInput('Pwsh', { command: 'echo' })).toBe('echo');
      expect(summarizeToolInput('Grep', { pattern: 'x' })).toBe('x');
      expect(summarizeToolInput('Glob', { pattern: '*.ts' })).toBe('*.ts');
      expect(summarizeToolInput('WebFetch', { url: 'https://a' })).toBe('https://a');
      expect(summarizeToolInput('WebSearch', { query: 'q' })).toBe('q');
    } finally {
      delete process.env.AURAXIS_REMOTE_API;
      delete process.env.AURAXIS_REMOTE_TOKEN;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
