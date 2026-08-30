import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const cli = path.join(projectRoot, 'packages', 'cli', 'dist', 'main.js');
const provider = process.argv[2] || process.env.AURAXIS_LIVE_PROVIDER || 'deepseek';
const model = process.env.AURAXIS_LIVE_MODEL || 'deepseek-v4-flash';

const child = spawn(
  process.execPath,
  [
    cli,
    '--run',
    '只回复 OK',
    '--provider',
    provider,
    '--model',
    model,
    '--reasoning-effort',
    'low',
    '--max-tokens',
    '64',
    '--auto-approve',
    '--json',
  ],
  {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  },
);
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => (stdout += String(chunk)));
child.stderr.on('data', (chunk) => (stderr += String(chunk)));
const code = await new Promise((resolve) => child.on('close', resolve));

if (code === 2 && /未配置 API Key/.test(stderr)) {
  console.log(`live e2e skipped: ${provider} API key not configured`);
  process.exit(0);
}
if (code !== 0 || !stdout.includes('"type":"result"')) {
  console.error(`live e2e failed for ${provider}/${model}`);
  console.error(stderr);
  console.error(stdout);
  process.exit(code || 1);
}
console.log(`live e2e ok: ${provider}/${model}`);
