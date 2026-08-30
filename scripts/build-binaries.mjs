import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const packageRoot = path.join(projectRoot, 'packages', 'cli');
const entrypoint = path.join(packageRoot, 'src', 'index.ts');
const outDir = path.join(packageRoot, 'native');
const aliasPath = path.join(packageRoot, 'vendor', 'react-devtools-core', 'index.mjs');

const TARGETS = {
  'bun-windows-x64': { file: 'auraxis-windows-x64.exe', label: 'Windows x64' },
  'bun-windows-arm64': { file: 'auraxis-windows-arm64.exe', label: 'Windows arm64' },
  'bun-darwin-x64': { file: 'auraxis-darwin-x64', label: 'macOS x64' },
  'bun-darwin-arm64': { file: 'auraxis-darwin-arm64', label: 'macOS arm64' },
  'bun-linux-x64': { file: 'auraxis-linux-x64', label: 'Linux x64' },
  'bun-linux-arm64': { file: 'auraxis-linux-arm64', label: 'Linux arm64' },
  'bun-linux-x64-musl': { file: 'auraxis-linux-x64-musl', label: 'Linux x64 musl' },
  'bun-linux-arm64-musl': { file: 'auraxis-linux-arm64-musl', label: 'Linux arm64 musl' },
};

function hostTarget() {
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'bun-windows-arm64' : 'bun-windows-x64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'bun-darwin-arm64' : 'bun-darwin-x64';
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'bun-linux-arm64' : 'bun-linux-x64';
  throw new Error(`不支持的构建平台: ${process.platform}/${process.arch}`);
}

function requestedTargets(args) {
  if (args.includes('--all')) return Object.keys(TARGETS);
  const named = args.filter((arg) => TARGETS[arg]);
  return named.length ? named : [hostTarget()];
}

async function buildOne(target) {
  const info = TARGETS[target];
  if (!info) throw new Error(`未知 Bun target: ${target}`);
  const outfile = path.join(outDir, info.file);
  await fs.mkdir(outDir, { recursive: true });
  console.log(`[native] building ${info.label} (${target}) -> ${path.relative(projectRoot, outfile)}`);

  const result = await Bun.build({
    entrypoints: [entrypoint],
    target: 'bun',
    minify: true,
    plugins: [
      {
        name: 'auraxis-react-devtools-alias',
        setup(build) {
          build.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: aliasPath }));
        },
      },
    ],
    compile: {
      target,
      outfile,
    },
  });
  if (!result.success) {
    for (const error of result.logs) {
      console.error(error);
    }
    throw new Error(`native build failed for ${target}`);
  }

  if (process.platform !== 'win32') {
    await fs.chmod(outfile, 0o755);
  }
  return outfile;
}

async function writeChecksum(builtFiles) {
  const existing = (await fs.readdir(outDir))
    .filter((name) => name !== 'SHA256SUMS.txt')
    .map((name) => path.join(outDir, name));
  const files = [...new Set([...builtFiles, ...existing])];
  const lines = [];
  for (const file of files) {
    const data = await fs.readFile(file);
    const digest = createHash('sha256').update(data).digest('hex');
    lines.push(`${digest}  ${path.basename(file)}`);
  }
  await fs.writeFile(path.join(outDir, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8');
  console.log(`[native] wrote SHA256SUMS.txt (${lines.length} files)`);
}

const targets = requestedTargets(process.argv.slice(2));
const files = [];
for (const target of targets) {
  files.push(await buildOne(target));
}
await writeChecksum(files);
console.log(`[native] done: ${files.length} binary(ies)`);
