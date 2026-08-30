import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-e2e-code-'));

const program = [
  'const w = await tools.Write({ file_path: "from-code.txt", content: "hello from code mode" });',
  'console.log("write result:", w);',
  'const l = await tools.ListFiles({ path: "." });',
  'console.log("files:", l.includes("from-code.txt") ? "ok" : "missing");',
].join('\n');
await fs.writeFile(path.join(workDir, 'program.ts'), program, 'utf8');

const child = spawn(
  process.execPath,
  [
    path.join(projectRoot, 'packages', 'cli', 'dist', 'main.js'),
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
    },
  },
);

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => (stdout += String(chunk)));
child.stderr.on('data', (chunk) => (stderr += String(chunk)));
const code = await new Promise((resolve) => child.on('close', resolve));

if (code !== 0) {
  console.error(stderr);
  process.exit(code || 1);
}
if (!stdout.includes('"type":"code_result"') || !stdout.includes('"ok":true') || !stdout.includes('write result:')) {
  console.error('code mode e2e failed: result event missing');
  console.error(stdout);
  process.exit(1);
}
const output = await fs.readFile(path.join(workDir, 'from-code.txt'), 'utf8');
if (output !== 'hello from code mode') {
  console.error(`code mode e2e failed: unexpected file content ${output}`);
  process.exit(1);
}
console.log('code mode e2e ok:', stdout.trim().split('\n').at(-1));
