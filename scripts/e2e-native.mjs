import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const nativeName =
  process.platform === 'win32'
    ? process.arch === 'arm64'
      ? 'auraxis-windows-arm64.exe'
      : 'auraxis-windows-x64.exe'
    : process.platform === 'darwin'
      ? process.arch === 'arm64'
        ? 'auraxis-darwin-arm64'
        : 'auraxis-darwin-x64'
      : process.arch === 'arm64'
        ? 'auraxis-linux-arm64'
        : 'auraxis-linux-x64';
const binary =
  process.env.AURAXIS_NATIVE_BIN ||
  path.join(
    projectRoot,
    'packages',
    'cli',
    'native',
    nativeName,
  );

const run = (args, cwd) =>
  new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        AURAXIS_HOME: path.join(cwd, 'auraxis-data'),
        AURAXIS_ALLOW_UNSAFE_CODE: '1',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

try {
  await fs.access(binary);
} catch {
  console.error(`native binary not found: ${binary}`);
  console.error('run: npm run build:native');
  process.exit(1);
}

const cliPackage = JSON.parse(
  await fs.readFile(path.join(projectRoot, 'packages', 'cli', 'package.json'), 'utf8'),
);
const version = await run(['--version'], projectRoot);
if (version.code !== 0 || version.stdout.trim() !== cliPackage.version) {
  console.error(`version check failed: ${JSON.stringify(version)}`);
  process.exit(1);
}

const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auraxis-native-'));
const program = [
  'const w = await tools.Write({ file_path: "from-native.txt", content: "hello from native" });',
  'console.log("write result:", w);',
  'const l = await tools.ListFiles({ path: "." });',
  'console.log("files:", l.includes("from-native.txt") ? "ok" : "missing");',
].join('\n');
await fs.writeFile(path.join(workDir, 'program.ts'), program, 'utf8');

const codeResult = await run(
  [
    '--code-file',
    'program.ts',
    '--project',
    workDir,
    '--auto-approve',
    '--json',
  ],
  projectRoot,
);
if (codeResult.code !== 0 || !codeResult.stdout.includes('"type":"code_result"') || !codeResult.stdout.includes('"ok":true')) {
  console.error('native code mode failed');
  console.error(codeResult.stderr);
  console.error(codeResult.stdout);
  process.exit(codeResult.code || 1);
}

const output = await fs.readFile(path.join(workDir, 'from-native.txt'), 'utf8');
if (output !== 'hello from native') {
  console.error(`unexpected native output: ${output}`);
  process.exit(1);
}
console.log('native smoke ok');
