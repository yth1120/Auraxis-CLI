import { describe, expect, it } from 'vitest';
import { HOME_COMMANDS, buildBlockTitle, formatSessionTime, shortenProjectPath } from '../ui/home.js';

describe('home card helpers', () => {
  it('formats session time as hh:mm:ss', () => {
    expect(formatSessionTime(0)).toBe('00:00:00');
    expect(formatSessionTime(65)).toBe('00:01:05');
    expect(formatSessionTime(3661)).toBe('01:01:01');
  });

  it('provides five keyboard quick commands', () => {
    expect(HOME_COMMANDS.map((command) => command.command)).toEqual([
      '/model',
      '/permission',
      '/reasoning',
      '/mcp',
      '/help',
    ]);
  });

  it('builds a consistent five-row block title', () => {
    const lines = buildBlockTitle('AURAXIS');
    expect(lines).toHaveLength(5);
    expect(lines.map((line) => [...line].length)).toEqual([41, 41, 41, 41, 41]);
  });

  it('builds the larger Auraxis Agent block title', () => {
    const lines = buildBlockTitle('AURAXIS AGENT');
    expect(lines).toHaveLength(5);
    expect(lines.every((line) => [...line].length === 73)).toBe(true);
  });

  it('shortens absolute paths to a home-relative tail', () => {
    const project = String.raw`C:\Users\After\Desktop\projects\Auraxis-CLI\packages\cli`;
    const home = String.raw`C:\Users\After`;

    expect(shortenProjectPath(`${home}\\demo`, home, 40)).toBe('~/demo');
    expect(shortenProjectPath(project, home, 32)).toBe('~/…/Auraxis-CLI/packages/cli');
    expect(shortenProjectPath(project, home, 22)).toBe('~/…/packages/cli');
  });

  it('never exceeds the requested compact path length', () => {
    const project = String.raw`C:\Users\After\Desktop\projects\Auraxis-CLI\packages\cli`;
    const result = shortenProjectPath(project, String.raw`C:\Users\After`, 18);
    expect(result.length).toBeLessThanOrEqual(18);
  });

  it('handles missing glyphs, short lengths and non-home paths', () => {
    expect(buildBlockTitle('###')).toEqual([]);
    expect(formatSessionTime(-5)).toBe('00:00:00');
    expect(shortenProjectPath('/project/deep/path', '/home', 5)).toBe('/path');
    expect(shortenProjectPath('/outside/deep/path', '/home', 10)).toBe('…/path');
  });
});
