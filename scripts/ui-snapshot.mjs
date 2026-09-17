/**
 * 执行视图渲染快照：把 ExecutionPanel 在几种典型状态下画到终端，
 * 供人工或 CI 目视检查排版（时间轴、状态、输出缩进、折叠提示）。
 *
 * 用法：node scripts/ui-snapshot.mjs
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-ui-snapshot-'));
const entry = path.join(tmpDir, 'entry.tsx');
// 输出到 packages/cli/dist 下，便于解析 ink / react 等运行时依赖。
const outfile = path.join(root, 'packages', 'cli', 'dist', '.ui-snapshot.mjs');

const entryTarget = path.join(root, 'packages', 'cli', 'src', 'ui', 'blocks.js').replace(/\\/g, '/');
await fs.writeFile(
  entry,
  `export * from ${JSON.stringify(entryTarget)};\n`,
  'utf8',
);

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  jsx: 'automatic',
  external: ['ink', 'react', 'react-dom', 'fast-glob'],
  nodePaths: [path.join(root, 'node_modules')],
  alias: { 'react-devtools-core': path.join(root, 'packages', 'cli', 'vendor', 'react-devtools-core', 'index.mjs') },
  logLevel: 'warning',
});

// 让 ink 认为 stdout 是 TTY，并按固定宽度渲染。
const realWrite = process.stdout.write.bind(process.stdout);
let captured = '';
const stdout = Object.create(process.stdout);
stdout.columns = 96;
stdout.rows = 40;
stdout.isTTY = true;
stdout.hasColors = () => false;
stdout.getColorDepth = () => 1;
stdout.write = (chunk) => {
  captured += String(chunk);
  return true;
};
stdout.on = () => undefined;
stdout.off = () => undefined;
stdout.removeListener = () => undefined;

const React = (await import('react')).default;
const { render } = await import('ink');
const ui = await import(pathToFileURL(outfile).href);

const now = Date.now();
const base = [
  { id: 'a', kind: 'tool', name: 'ListFiles', status: 'done', summary: 'path: .', duration: 1, startedAt: now - 5200, finishedAt: now - 5199 },
  { id: 'b', kind: 'tool', name: 'Glob', status: 'done', summary: 'pattern: **/*.ts', duration: 5, startedAt: now - 5000, finishedAt: now - 4995 },
  { id: 'c', kind: 'tool', name: 'Write', status: 'done', summary: 'file_path: src/temperature.ts', duration: 2, startedAt: now - 3000, finishedAt: now - 2998 },
  { id: 'd', kind: 'tool', name: 'Edit', status: 'error', summary: 'file_path: README.md', error: 'old_string 未找到匹配', duration: 3, startedAt: now - 1200, finishedAt: now - 1000 },
];
const scenarios = [
  { title: '运行中 + 状态栏', items: [...base, { id: 'e', kind: 'tool', name: 'Bash', status: 'running', summary: 'node --test', startedAt: now - 900 }], running: true, expanded: false, withStatusBar: true },
  { title: '全部完成', items: base.map((item) => ({ ...item, status: 'done', error: undefined })), running: false, expanded: false },
  {
    title: '展开输出',
    items: [{ id: 'f', kind: 'tool', name: 'Bash', status: 'done', summary: 'npm test', duration: 1420, startedAt: now - 2000, finishedAt: now - 580, output: '> temperature-utils@1.0.0 test\n\nℹ tests 33\nℹ pass 33\nℹ fail 0' }],
    running: false,
    expanded: true,
  },
  {
    kind: 'transcript',
    title: '对话区工具卡片',
    entries: [
      { type: 'user', text: '修一下温度转换的测试' },
      { type: 'tool', name: 'Read', summary: 'file_path: tests/temperature.test.ts', status: 'done', duration: 2, output: ' 1| import { cToF } from "../src/temperature.ts";' },
      { type: 'tool', name: 'Edit', summary: 'file_path: tests/temperature.test.ts', status: 'done', duration: 3 },
      { type: 'tool', name: 'Bash', summary: 'node --test', status: 'error', error: '命令退出码 1', duration: 940, output: 'ERR_ASSERTION: expected -273.2 but got -273.1' },
      { type: 'tool', name: 'Write', summary: 'file_path: tests/temperature.test.ts', status: 'done', duration: 4 },
      { type: 'tool', name: 'Bash', summary: 'node --test', status: 'done', duration: 1180, output: 'tests 33\npass 33\nfail 0' },
      { type: 'assistant', text: '33 项用例全部通过。' },
    ],
  },
];

for (const scenario of scenarios) {
  captured = '';
  if (scenario.kind === 'transcript') {
    const isToolLike = (entry) => entry.type === 'tool' || entry.type === 'code_tool';
    const children = scenario.entries.map((entry, index) => {
      if (entry.type === 'user') return React.createElement(ui.UserBlock, { key: index, text: entry.text });
      if (entry.type === 'assistant') return React.createElement(ui.AssistantBlock, { key: index, text: entry.text });
      if (entry.type === 'system') return React.createElement(ui.SystemBlock, { key: index, text: entry.text });
      const grouped = isToolLike(scenario.entries[index - 1]) || isToolLike(scenario.entries[index + 1]);
      return React.createElement(ui.ToolBlock, {
        key: index,
        name: entry.name,
        summary: entry.summary,
        status: entry.status,
        ok: entry.status !== 'error',
        error: entry.error,
        duration: entry.duration,
        output: entry.output,
        grouped,
        first: !isToolLike(scenario.entries[index - 1]),
        last: !isToolLike(scenario.entries[index + 1]),
      });
    });
    const app = render(
      React.createElement(ui.ThemeProvider, { theme: 'dark' }, React.createElement(React.Fragment, null, children)),
      { stdout },
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    app.unmount();
    realWrite(`\n===== ${scenario.title} =====\n${captured}\n`);
    continue;
  }
  const panel = React.createElement(ui.ExecutionPanel, {
    items: scenario.items,
    running: scenario.running,
    expanded: scenario.expanded,
  });
  const app = render(
    React.createElement(
      ui.ThemeProvider,
      { theme: 'dark' },
      scenario.withStatusBar
        ? React.createElement(
            React.Fragment,
            null,
            panel,
            React.createElement(ui.StatusBar, {
              model: 'deepseek-flash',
              permission: 'ask',
              reasoningEffort: 'high',
              running: true,
              currentTool: 'Bash',
            }),
          )
        : panel,
    ),
    { stdout },
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  app.unmount();
  realWrite(`\n===== ${scenario.title} =====\n${captured}\n`);
}

await fs.rm(tmpDir, { recursive: true, force: true });
await fs.rm(outfile, { force: true });
