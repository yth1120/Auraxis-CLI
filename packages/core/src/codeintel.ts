import fsp from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';

export interface SymbolRecord {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'other';
  file: string;
  line: number;
}

const SOURCE_EXTENSIONS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'go',
  'rs',
  'java',
  'cs',
  'php',
  'rb',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'vue',
  'svelte',
];

const SYMBOL_RE =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

function kindFor(match: RegExpExecArray): SymbolRecord['kind'] {
  const declaration = match[0];
  if (/class\b/.test(declaration)) return 'class';
  if (/interface\b/.test(declaration)) return 'interface';
  if (/type\b/.test(declaration)) return 'type';
  if (/enum\b/.test(declaration)) return 'enum';
  if (/function\b/.test(declaration)) return 'function';
  if (/(?:const|let|var)\b/.test(declaration)) return 'variable';
  return 'other';
}

export async function scanSymbols(projectRoot: string): Promise<SymbolRecord[]> {
  const files = await fg(
    SOURCE_EXTENSIONS.map((extension) => `**/*.${extension}`),
    {
      cwd: projectRoot,
      onlyFiles: true,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/coverage/**', '**/.auraxis/**'],
      suppressErrors: true,
    },
  );
  const symbols: SymbolRecord[] = [];
  for (const file of files.slice(0, 5_000)) {
    try {
      const stat = await fsp.stat(file);
      if (stat.size > 512 * 1024) continue;
      const content = await fsp.readFile(file, 'utf8');
      SYMBOL_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = SYMBOL_RE.exec(content)) && symbols.length < 20_000) {
        const name = match[1] || match[2];
        if (!name) continue;
        symbols.push({
          name,
          kind: kindFor(match),
          file: path.relative(projectRoot, file),
          line: content.slice(0, match.index).split(/\r?\n/).length,
        });
      }
    } catch {
      /* ignore unreadable files */
    }
  }
  return symbols;
}

export async function findSymbols(projectRoot: string, name: string, limit = 20): Promise<SymbolRecord[]> {
  const keyword = name.trim().toLowerCase();
  if (!keyword) return [];
  const symbols = await scanSymbols(projectRoot);
  return symbols
    .filter((symbol) => symbol.name.toLowerCase().includes(keyword))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit);
}
