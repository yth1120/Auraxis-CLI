import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const single = process.argv.includes('--single');
const watch = process.argv.includes('--watch');

await build({
  entryPoints: [path.join(root, 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(root, 'dist', single ? 'single.js' : 'main.js'),
  external: single
    ? ['os', 'path', 'fs', 'child_process', 'url', 'stream', 'util', 'crypto', 'events', 'http', 'https', 'tty', 'readline', 'module', 'worker_threads', 'typescript5']
    : ['fast-glob', 'ink', 'react', 'react-dom', 'typescript5'],
  alias: {
    'react-devtools-core': path.join(root, 'vendor', 'react-devtools-core', 'index.mjs'),
  },
  banner: single
    ? { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }
    : undefined,
  logLevel: 'info',
  ...(watch ? { watch: true } : {}),
});
