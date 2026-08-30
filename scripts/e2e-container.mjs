import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const cli = path.join(projectRoot, 'packages', 'cli', 'dist', 'main.js');
const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-container-'));

const dockerCheck = spawnSync('docker', ['info'], { stdio: 'ignore' });
if (dockerCheck.status !== 0) {
  console.log('container e2e skipped: docker daemon unavailable');
  process.exit(0);
}

const program = [
  'const out = await tools.Bash({ command: "printf container-ok" });',
  'console.log(String(out).includes("container-ok") ? "container-tools-ok" : "container-tools-failed");',
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
    '--sandbox',
    'container',
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

if (code !== 0 || !stdout.includes('"type":"code_result"') || !stdout.includes('"ok":true') || !stdout.includes('container-tools-ok')) {
  console.error('container e2e failed');
  console.error(stderr);
  console.error(stdout);
  process.exit(code || 1);
}
console.log('container e2e ok');
