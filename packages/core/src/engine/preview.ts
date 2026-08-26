import fsp from 'node:fs/promises';
import { resolveInside } from '../tools/files.js';
import type { JsonObject } from '../types.js';

const MAX_PREVIEW_LINES = 80;

async function readMaybe(file: string): Promise<string> {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

function diffLines(oldText: string, newText: string): string {
  const oldLines = oldText.length ? oldText.split(/\r?\n/) : [];
  const newLines = newText.length ? newText.split(/\r?\n/) : [];
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const removed = oldLines.slice(prefix, oldLines.length - suffix);
  const added = newLines.slice(prefix, newLines.length - suffix);
  const contextBefore = oldLines.slice(Math.max(0, prefix - 3), prefix);
  const contextAfter = oldLines.slice(oldLines.length - suffix, oldLines.length - suffix + 3);
  const lines = [
    ...contextBefore.map((line) => `  ${line}`),
    ...removed.map((line) => `- ${line}`),
    ...added.map((line) => `+ ${line}`),
    ...contextAfter.map((line) => `  ${line}`),
  ];
  return lines.slice(0, MAX_PREVIEW_LINES).join('\n');
}

export async function buildPermissionPreview(
  toolName: string,
  args: JsonObject,
  projectRoot: string,
): Promise<string> {
  try {
    switch (toolName) {
      case 'Write': {
        const file = resolveInside(projectRoot, args.file_path);
        const oldText = await readMaybe(file);
        const newText = typeof args.content === 'string' ? args.content : '';
        return `--- ${file}\n+++ ${file}${oldText ? '' : '（新文件）'}\n${diffLines(oldText, newText)}`;
      }
      case 'Edit':
      case 'StrReplaceEditor': {
        const file = resolveInside(projectRoot, args.file_path);
        const current = await readMaybe(file);
        const oldText = typeof args.old_string === 'string' ? args.old_string : '';
        const newText = typeof args.new_string === 'string' ? args.new_string : '';
        return `--- ${file}\n+++ ${file}\n${diffLines(current, current.replace(oldText, newText))}`;
      }
      case 'Bash':
        return `$ ${String(args.command || '')}`;
      case 'Pwsh':
        return `> ${String(args.command || '')}`;
      case 'WebFetch':
        return `URL: ${String(args.url || '')}`;
      case 'WebSearch':
        return `Query: ${String(args.query || '')}`;
      default:
        return JSON.stringify(args, null, 2).slice(0, 2000);
    }
  } catch {
    return '';
  }
}

