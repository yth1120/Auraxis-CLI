import fsp from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import type { JsonObject } from '../types.js';
import type { ToolContext, ToolOutput } from './registry.js';

const MAX_FILE_BYTES = 512 * 1024;
const IGNORED_DIRS = ['node_modules', '.git', 'dist', 'build', 'coverage', '.auraxis'];

export function resolveInside(root: string, raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('路径不能为空');
  const resolved = path.resolve(root, raw);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error(`路径超出项目根目录: ${resolved}`);
  }
  return resolved;
}

async function isTooLarge(file: string): Promise<boolean> {
  const stat = await fsp.stat(file);
  return stat.isDirectory() || stat.size > MAX_FILE_BYTES;
}

async function readTextOrPreview(file: string): Promise<string> {
  const stat = await fsp.stat(file);
  if (stat.isDirectory()) throw new Error('目标是一个目录');
  if (stat.size > MAX_FILE_BYTES) {
    const handle = await fsp.open(file, 'r');
    const buffer = Buffer.alloc(MAX_FILE_BYTES);
    await handle.read(buffer, 0, MAX_FILE_BYTES, 0);
    await handle.close();
    return `${buffer.toString('utf8')}\n\n[内容超过 512KB，已截断]`;
  }
  return fsp.readFile(file, 'utf8');
}

function prettyContent(file: string, content: string): string {
  const relative = path.relative(process.cwd(), file);
  const lines = content.split(/\r?\n/);
  return lines.map((line, index) => `${String(index + 1).padStart(4)}| ${line}`).join('\n') + `\n[${relative} · ${lines.length} 行]`;
}

export async function readFileTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const file = resolveInside(ctx.projectRoot, input.file_path);
  const content = await readTextOrPreview(file);
  return { content: prettyContent(file, content) };
}

export async function readImageFileTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const file = resolveInside(ctx.projectRoot, input.file_path);
  const stat = await fsp.stat(file);
  if (stat.size > 10 * 1024 * 1024) throw new Error('图片超过 10MB，无法发送给模型');
  const extension = path.extname(file).toLowerCase();
  const mimeByExtension: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  const mime = mimeByExtension[extension];
  if (!mime) throw new Error('仅支持 JPEG / PNG / GIF / WebP');
  const buffer = await fsp.readFile(file);
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  const prompt = typeof input.prompt === 'string' && input.prompt ? input.prompt : '请分析这张图片。';
  return {
    content: `图片已读取: ${path.relative(ctx.projectRoot, file)} (${Math.round(stat.size / 1024)} KB)`,
    artifact: {
      file_path: file,
      mimeType: mime,
      dataUrl,
      prompt,
    },
  };
}

export async function writeFileTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const file = resolveInside(ctx.projectRoot, input.file_path);
  const content = typeof input.content === 'string' ? input.content : '';
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content, 'utf8');
  return { content: `OK 已写入 ${path.relative(ctx.projectRoot, file)}` };
}

export async function editFileTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const file = resolveInside(ctx.projectRoot, input.file_path);
  const oldString = typeof input.old_string === 'string' ? input.old_string : '';
  const newString = typeof input.new_string === 'string' ? input.new_string : '';
  const replaceAll = input.replace_all === true;
  if (!oldString) throw new Error('old_string 不能为空');
  const current = await fsp.readFile(file, 'utf8');
  const count = current.split(oldString).length - 1;
  if (count === 0) throw new Error('old_string 未找到');
  if (count > 1 && !replaceAll) throw new Error(`匹配到 ${count} 处，请设置 replace_all=true`);
  const next = replaceAll ? current.split(oldString).join(newString) : current.replace(oldString, newString);
  await fsp.writeFile(file, next, 'utf8');
  return { content: `OK 已替换 ${count} 处: ${path.relative(ctx.projectRoot, file)}` };
}

export async function runFileTools(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const relative = typeof input.path === 'string' && input.path ? input.path : '.';
  const dir = resolveInside(ctx.projectRoot, relative);
  const stat = await fsp.stat(dir);
  if (!stat.isDirectory()) throw new Error('目标不是目录');
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const lines = entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => `${entry.isDirectory() ? 'd' : '-'} ${entry.name}`)
    .slice(0, 300);
  return { content: lines.join('\n') || '(空目录)' };
}

export async function grepTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const pattern = typeof input.pattern === 'string' ? input.pattern : '';
  if (!pattern) throw new Error('pattern 不能为空');
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'i');
  } catch {
    throw new Error(`无效正则: ${pattern}`);
  }
  const base = typeof input.path === 'string' && input.path ? resolveInside(ctx.projectRoot, input.path) : ctx.projectRoot;
  const stat = await fsp.stat(base);
  const files = stat.isDirectory()
    ? await fg(['**/*'], { cwd: base, onlyFiles: true, ignore: IGNORED_DIRS.map((d) => `**/${d}/**`), absolute: true, suppressErrors: true })
    : [base];
  const maxMatches = typeof input.max_matches === 'number' ? Math.max(1, Math.floor(input.max_matches)) : 200;
  const hits: string[] = [];
  for (const file of files.slice(0, 400)) {
    if (hits.length >= maxMatches) break;
    if ((await isTooLarge(file)) && !stat.isDirectory()) continue;
    try {
      const content = await fsp.readFile(file, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        if (regex.test(lines[i])) {
          hits.push(`${path.relative(ctx.projectRoot, file)}:${i + 1}: ${lines[i].trim().slice(0, 240)}`);
          if (hits.length >= maxMatches) break;
        }
      }
    } catch {
      /* unreadable files are skipped */
    }
  }
  return { content: hits.length ? hits.join('\n') : '未找到匹配' };
}

export async function globTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const pattern = typeof input.pattern === 'string' ? input.pattern : '**/*';
  const cwd = typeof input.cwd === 'string' && input.cwd ? resolveInside(ctx.projectRoot, input.cwd) : ctx.projectRoot;
  const files = await fg([pattern], {
    cwd,
    onlyFiles: true,
    ignore: IGNORED_DIRS.map((d) => `**/${d}/**`),
    absolute: true,
    suppressErrors: true,
  });
  const lines = files.slice(0, 500).map((file) => path.relative(ctx.projectRoot, file));
  return { content: lines.length ? lines.join('\n') : '未找到匹配文件' };
}
