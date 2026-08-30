import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuraxisClient } from '../packages/core/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-sdk-'));

const server = http.createServer((_request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const payload = {
    id: 'sdk-e2e',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'e2e',
    choices: [{ index: 0, delta: { content: 'sdk ok' }, finish_reason: 'stop' }],
  };
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
  response.write('data: [DONE]\n\n');
  response.end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const apiBase = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/chat/completions`;

const client = new AuraxisClient({
  bin: process.execPath,
  cliPath: path.join(root, 'packages', 'cli', 'dist', 'main.js'),
  projectRoot: workDir,
  apiKey: 'test-key',
  apiBase,
  mode: 'auto',
  sandbox: 'workspace-write',
  autoApprove: true,
  env: { AURAXIS_HOME: path.join(workDir, 'auraxis-data') },
});
try {
  await client.connect();
  const threadId = await client.startThread();
  if (!threadId) throw new Error('thread id empty');
  const result = await client.run(threadId, 'hello');
  if (result.text !== 'sdk ok') throw new Error(`unexpected text: ${result.text}`);
  console.log('sdk e2e ok');
} finally {
  await client.close();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
