import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(root, 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(root, 'dist', 'main.js'),
  external: ['fast-glob', 'ink', 'react', 'react-dom'],
  alias: {
    'react-devtools-core': path.join(root, 'vendor', 'react-devtools-core', 'index.mjs'),
  },
  logLevel: 'info',
});
