export interface CodeBlockSegment {
  text?: string;
  code?: string;
  language?: string;
}

export interface InlineMarkdownSegment {
  type: 'text' | 'strong' | 'code';
  text: string;
}

export function parseInlineMarkdown(text: string): InlineMarkdownSegment[] {
  const segments: InlineMarkdownSegment[] = [];
  const regex = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    if (match.index > last) segments.push({ type: 'text', text: text.slice(last, match.index) });
    const raw = match[0];
    segments.push(
      raw.startsWith('**')
        ? { type: 'strong', text: raw.slice(2, -2) }
        : { type: 'code', text: raw.slice(1, -1) },
    );
    last = regex.lastIndex;
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
  if (!segments.length) segments.push({ type: 'text', text });
  return segments;
}

export function splitCodeBlocks(text: string): CodeBlockSegment[] {
  const result: CodeBlockSegment[] = [];
  const regex = /```([\w-]+)?\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    if (match.index > last) result.push({ text: text.slice(last, match.index) });
    result.push({ language: match[1] || '', code: match[2].replace(/\n$/, '') });
    last = regex.lastIndex;
  }
  if (last < text.length) result.push({ text: text.slice(last) });
  return result;
}

export function isDiffCodeBlock(block: Pick<CodeBlockSegment, 'code' | 'language'>): boolean {
  const language = block.language?.trim().toLowerCase();
  if (language === 'diff') return true;
  const code = block.code || '';
  return /^(?:--- |\+\+\+ |@@ )/.test(code);
}
