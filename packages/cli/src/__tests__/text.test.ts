import { describe, expect, it } from 'vitest';
import { displayWidth, stepSummary, timelineNode, truncateByWidth } from '../ui/text.js';

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

  it('builds execution timeline connectors', () => {
    expect(timelineNode(true, false)).toEqual({ node: '╭─', prefix: '│ ' });
    expect(timelineNode(false, false)).toEqual({ node: '├─', prefix: '│ ' });
    expect(timelineNode(false, true)).toEqual({ node: '╰─', prefix: '  ' });
    // 单行同时是首行与末行时收尾优先，保持与输出缩进一致。
    expect(timelineNode(true, true)).toEqual({ node: '╰─', prefix: '  ' });
  });

  it('summarizes execution steps with optional failures', () => {
    expect(stepSummary(6)).toBe('6 步');
    expect(stepSummary(6, 0)).toBe('6 步');
    expect(stepSummary(6, 2)).toBe('6 步 · 2 失败');
  });
});
