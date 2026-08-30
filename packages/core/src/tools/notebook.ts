import fsp from 'node:fs/promises';
import type { JsonObject } from '../types.js';
import type { ToolContext, ToolOutput } from './registry.js';
import { resolveInside } from './files.js';

interface IpynbCell {
  cell_type: 'code' | 'markdown' | string;
  source?: string | string[];
  execution_count?: number | null;
  metadata?: Record<string, unknown>;
  outputs?: unknown[];
}

export async function notebookEditTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const file = resolveInside(ctx.projectRoot, input.file_path);
  if (!file.toLowerCase().endsWith('.ipynb')) throw new Error('仅支持 .ipynb 文件');
  const raw = await fsp.readFile(file, 'utf8').catch(() => null);
  if (raw === null) throw new Error(`文件不存在: ${String(input.file_path)}`);
  const parsed = JSON.parse(raw) as { cells?: IpynbCell[] };
  if (!Array.isArray(parsed.cells)) throw new Error('无效的 .ipynb 文件: 缺少 cells 数组');
  const action = typeof input.action === 'string' ? input.action : 'read';
  const cellIndex =
    typeof input.cell_index === 'number'
      ? Math.floor(input.cell_index)
      : action === 'insert'
        ? parsed.cells.length
        : 0;
  if (cellIndex < 0 || (action !== 'insert' && cellIndex >= parsed.cells.length)) {
    throw new Error(`单元格索引 ${cellIndex} 超出范围`);
  }
  const source = typeof input.source === 'string' ? input.source : '';
  if (action === 'write' || action === 'insert') {
    if (ctx.undo) await ctx.undo.push(ctx.sessionId || '', file, raw);
  }
  if (action === 'read') {
    const cell = parsed.cells[cellIndex];
    return {
      content: JSON.stringify({
        cell_index: cellIndex,
        cell_type: cell?.cell_type,
        source: Array.isArray(cell?.source) ? cell.source.join('') : String(cell?.source || ''),
        execution_count: cell?.execution_count ?? null,
        metadata: cell?.metadata || {},
      }),
    };
  }
  if (action === 'write') {
    if (source === '') throw new Error('write 操作需要 source 参数');
    parsed.cells[cellIndex] = {
      ...parsed.cells[cellIndex],
      source: source.split(/\r?\n/),
    };
    await fsp.writeFile(file, JSON.stringify(parsed, null, 1), 'utf8');
    return { content: JSON.stringify({ cell_index: cellIndex, action, message: `已更新单元格 ${cellIndex}` }) };
  }
  if (action === 'insert') {
    if (source === '') throw new Error('insert 操作需要 source 参数');
    parsed.cells.splice(cellIndex, 0, {
      cell_type: input.cell_type === 'markdown' ? 'markdown' : 'code',
      metadata: {},
      source: source.split(/\r?\n/),
      outputs: [],
      execution_count: null,
    });
    await fsp.writeFile(file, JSON.stringify(parsed, null, 1), 'utf8');
    return { content: JSON.stringify({ cell_index: cellIndex, action, message: `已在位置 ${cellIndex} 插入新单元格` }) };
  }
  if (action === 'delete') {
    parsed.cells.splice(cellIndex, 1);
    await fsp.writeFile(file, JSON.stringify(parsed, null, 1), 'utf8');
    return { content: JSON.stringify({ cell_index: cellIndex, action, message: `已删除单元格 ${cellIndex}` }) };
  }
  throw new Error(`未知操作: ${action}`);
}
