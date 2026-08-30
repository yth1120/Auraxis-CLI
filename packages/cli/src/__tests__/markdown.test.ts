import { describe, expect, it } from 'vitest';
import { isDiffCodeBlock, parseInlineMarkdown, splitCodeBlocks } from '../ui/markdown.js';

describe('markdown code blocks', () => {
  it('splits fenced code blocks and keeps the language', () => {
    const blocks = splitCodeBlocks('before\n```ts\nconst a = 1;\n```\nafter');
    expect(blocks).toEqual([
      { text: 'before\n' },
      { language: 'ts', code: 'const a = 1;' },
      { text: '\nafter' },
    ]);
  });

  it('detects diff blocks by language or diff headers', () => {
    expect(isDiffCodeBlock({ language: 'diff', code: '+a\n-b' })).toBe(true);
    expect(isDiffCodeBlock({ language: '', code: '--- a\n+++ b\n@@ -1,2 +1,2 @@\n-old\n+new' })).toBe(true);
    expect(isDiffCodeBlock({ language: 'ts', code: 'const a = 1;' })).toBe(false);
  });

  it('returns a single text segment without fences', () => {
    expect(splitCodeBlocks('plain text')).toEqual([{ text: 'plain text' }]);
  });

  it('parses inline bold and code without leaking markers', () => {
    expect(parseInlineMarkdown('请运行 `npm test` 并 **修复** 问题')).toEqual([
      { type: 'text', text: '请运行 ' },
      { type: 'code', text: 'npm test' },
      { type: 'text', text: ' 并 ' },
      { type: 'strong', text: '修复' },
      { type: 'text', text: ' 问题' },
    ]);
  });

  it('keeps unmatched markers as literal text', () => {
    expect(parseInlineMarkdown('**未闭合')).toEqual([{ type: 'text', text: '**未闭合' }]);
    expect(parseInlineMarkdown('`未闭合')).toEqual([{ type: 'text', text: '`未闭合' }]);
  });
});
