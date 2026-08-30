import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, '..');
const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-e2e-bash-'));

let calls = 0;
const server = http.createServer((_request, response) => {
  calls += 1;
  response.setHeader('Content-Type', 'text/event-stream');
  if (calls === 1) {
    response.write(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_bash","function":{"name":"Bash","arguments":"{\\"command\\":\\"node -e \\\"process.stdout.write(\\\\\\\"bash-ok\\\\\\\")\\\"\\"}"}}]}}]}\n\n',
    );
  } else {
    response.write('data: {"choices":[{"delta":{"content":"<FINAL_ANSWER>done"}}]}\n\n');
  }
  response.write('data: [DONE]\n\n');
  response.end();
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const apiBase = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/chat/completions`;

const child = spawn(
  process.execPath,
  [
    path.join(projectRoot, 'packages', 'cli', 'dist', 'main.js'),
    '--run',
    'run bash smoke',
    '--project',
    workDir,
    '--api-key',
    'test-key',
    '--api-base',
    apiBase,
    '--auto-approve',
    '--json',
  ],
  {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AURAXIS_HOME: path.join(workDir, 'auraxis-data') },
  },
);

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => (stdout += String(chunk)));
child.stderr.on('data', (chunk) => (stderr += String(chunk)));
const code = await new Promise((resolve) => child.on('close', resolve));
await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

if (code !== 0) {
  console.error(stderr);
  process.exit(code || 1);
}
if (!stdout.includes('"toolName":"Bash"') || !stdout.includes('"text":"done"')) {
  console.error('bash e2e failed: tool or final answer missing');
  console.error(stdout);
  process.exit(1);
}
console.log('bash e2e ok:', stdout.trim().split('\n').at(-1));
