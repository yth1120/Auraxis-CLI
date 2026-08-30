import { describe, expect, it } from 'vitest';
import {
  COMMAND_HINTS,
  commandHintLabel,
  isExactCommandHint,
  matchCommandHints,
  resolveCommandAlias,
  resolveSuggestedCommand,
} from '../ui/commands.js';

describe('command hints', () => {
  it('returns a compact starter menu when only / is typed', () => {
    expect(matchCommandHints('/')).toHaveLength(8);
  });

  it('matches command prefixes', () => {
    const matches = matchCommandHints('/mod');
    expect(matches[0].command).toBe('/model');
  });

  it('matches full command names', () => {
    expect(matchCommandHints('/permission')[0].command).toBe('/permission');
  });

  it('stops suggesting once arguments are typed', () => {
    expect(matchCommandHints('/model gpt-5')).toEqual([]);
  });

  it('ignores non-slash input', () => {
    expect(matchCommandHints('hello')).toEqual([]);
  });

  it('keeps all hint entries grouped and unique', () => {
    const commands = new Set(COMMAND_HINTS.map((hint) => hint.command));
    expect(commands.size).toBe(COMMAND_HINTS.length);
  });

  it('formats a compact hint label', () => {
    expect(commandHintLabel(COMMAND_HINTS[0])).toContain('/model');
    expect(commandHintLabel(COMMAND_HINTS[0])).toContain('选择模型');
  });

  it('resolves short aliases', () => {
    expect(resolveCommandAlias('mode')).toBe('permission');
    expect(resolveCommandAlias('e')).toBe('reasoning');
    expect(resolveCommandAlias('unknown')).toBe('unknown');
  });

  it('matches reasoning by its primary command name', () => {
    const matches = matchCommandHints('/reason');
    expect(matches.some((hint) => hint.command === '/reasoning')).toBe(true);
  });

  it('does not flood the menu with incidental letter matches', () => {
    const matches = matchCommandHints('/m').map((hint) => hint.command);
    expect(matches).toContain('/model');
    expect(matches).not.toContain('/sandbox');
  });

  it('recognises exact command and alias input', () => {
    const model = COMMAND_HINTS.find((hint) => hint.command === '/model')!;
    const permission = COMMAND_HINTS.find((hint) => hint.command === '/permission')!;
    expect(isExactCommandHint('/model', model)).toBe(true);
    expect(isExactCommandHint('/mode', permission)).toBe(true);
    expect(isExactCommandHint('/permission', model)).toBe(false);
  });

  it('executes the highlighted suggestion when submitting a slash menu', () => {
    const suggestions = matchCommandHints('/');
    expect(suggestions[0].command).toBe('/model');
    expect(resolveSuggestedCommand('/', suggestions, 0)).toBe('/model');
    expect(resolveSuggestedCommand('/model', suggestions, 0)).toBe('/model');
  });

  it('exposes all implemented execution and integration commands', () => {
    const commands = COMMAND_HINTS.map((hint) => hint.command);
    for (const expected of ['/files', '/complete', '/fim', '/context-budget', '/plugins', '/agents', '/worktree', '/code']) {
      expect(commands).toContain(expected);
    }
  });
});
