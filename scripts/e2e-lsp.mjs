import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const cli = path.join(projectRoot, 'packages', 'cli', 'dist', 'main.js');
const lspCli = path.join(projectRoot, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs');
const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-lsp-'));

await fs.writeFile(
  path.join(workDir, 'tsconfig.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
      },
      include: ['**/*.ts'],
    },
    null,
    2,
  )}\n`,
  'utf8',
);
await fs.writeFile(
  path.join(workDir, 'sample.ts'),
  [
    'export function helloWorld(): string {',
    '  return "hello";',
    '}',
    'const value = helloWorld();',
    'console.log(value);',
  ].join('\n'),
  'utf8',
);

const program = [
  'const def = await tools.LspDefinition({ file_path: "sample.ts", line: 3, column: 18 });',
  'console.log(String(def).includes("sample.ts") ? "lsp-definition-ok" : "lsp-definition-failed");',
  'const refs = await tools.LspReferences({ file_path: "sample.ts", line: 3, column: 18 });',
  'console.log(String(refs).includes("sample.ts") ? "lsp-references-ok" : "lsp-references-failed");',
].join('\n');
await fs.writeFile(path.join(workDir, 'program.ts'), program, 'utf8');

const child = spawn(
  process.execPath,
  [
    cli,
    '--code-file',
    'program.ts',
    '--project',
    workDir,
    '--auto-approve',
    '--json',
  ],
  {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AURAXIS_HOME: path.join(workDir, 'auraxis-data'),
      AURAXIS_ALLOW_UNSAFE_CODE: '1',
      AURAXIS_LSP_COMMAND: process.execPath,
      AURAXIS_LSP_ARGS: JSON.stringify([lspCli, '--stdio']),
      AURAXIS_LSP_INIT_OPTIONS: JSON.stringify({
        tsserver: {
          path: path.join(projectRoot, 'node_modules', 'typescript5', 'lib', 'tsserver.js'),
        },
      }),
    },
  },
);
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => (stdout += String(chunk)));
child.stderr.on('data', (chunk) => (stderr += String(chunk)));
const code = await new Promise((resolve) => child.on('close', resolve));

if (
  code !== 0 ||
  !stdout.includes('"type":"code_result"') ||
  !stdout.includes('"ok":true') ||
  !stdout.includes('lsp-definition-ok') ||
  !stdout.includes('lsp-references-ok')
) {
  console.error('lsp e2e failed');
  console.error(stderr);
  console.error(stdout);
  process.exit(code || 1);
}
console.log('lsp e2e ok');
