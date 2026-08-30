import { describe, expect, it } from 'vitest';
import { displayWidth, truncateByWidth } from '../ui/text.js';

describe('terminal text width', () => {
  it('counts CJK characters as two columns', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('你好')).toBe(4);
    expect(displayWidth('\u3000\uff00😀')).toBe(5);
  });

  it('truncates by visible columns', () => {
    expect(truncateByWidth('abcde', 3)).toBe('abc');
    expect(truncateByWidth('你好世界', 3)).toBe('你…');
    expect(truncateByWidth('', 6)).toBe('');
    expect(truncateByWidth('abc', 0)).toBe('');
  });
});
