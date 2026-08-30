import type { JsonObject } from '../types.js';
import type { ToolContext, ToolOutput } from './registry.js';

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeDuckUrl(raw: string): string {
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
    const target = url.searchParams.get('uddg');
    return target || url.toString();
  } catch {
    return raw;
  }
}

export async function webFetchTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const raw = typeof input.url === 'string' ? input.url : '';
  if (!raw) throw new Error('url 不能为空');
  ctx.sandbox?.assertNetwork(raw);
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('仅支持 http/https');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const maxChars = typeof input.max_chars === 'number' ? Math.max(1000, input.max_chars) : 50_000;
    return { content: stripHtml(text).slice(0, maxChars) };
  } finally {
    clearTimeout(timer);
  }
}

export async function webSearchTool(input: JsonObject, ctx: ToolContext): Promise<ToolOutput> {
  const query = typeof input.query === 'string' ? input.query : '';
  if (!query) throw new Error('query 不能为空');
  const maxResults = typeof input.max_results === 'number' ? Math.min(10, Math.max(1, input.max_results)) : 5;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  ctx.sandbox?.assertNetwork(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    const html = await response.text();
    const entries: Array<{ title: string; url: string; snippet: string }> = [];
    const blockRe = /<div class="result results_links[\s\S]*?<\/div>\s*<\/div>/gi;
    const titleRe = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
    const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i;
    let match: RegExpExecArray | null;
    while ((match = blockRe.exec(html)) && entries.length < maxResults) {
      const block = match[0];
      const titleMatch = titleRe.exec(block);
      const snippetMatch = snippetRe.exec(block);
      if (!titleMatch) continue;
      entries.push({
        title: stripHtml(titleMatch[2]).slice(0, 120),
        url: decodeDuckUrl(titleMatch[1]),
        snippet: snippetMatch ? stripHtml(snippetMatch[1]).slice(0, 300) : '',
      });
    }
    if (!entries.length) return { content: '未找到搜索结果' };
    return {
      content: entries
        .map((entry, index) => `${index + 1}. ${entry.title}\n   ${entry.url}\n   ${entry.snippet}`)
        .join('\n\n'),
    };
  } finally {
    clearTimeout(timer);
  }
}
