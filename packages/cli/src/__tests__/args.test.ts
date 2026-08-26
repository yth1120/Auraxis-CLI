import { describe, expect, it } from 'vitest';
import { parseArgs } from '../args.js';

describe('parseArgs', () => {
  it('parses common flags', () => {
    const args = parseArgs(['--run', 'fix login', '--model', 'deepseek-v4-flash', '--deep-think', '--json']);
    expect(args.run).toBe('fix login');
    expect(args.model).toBe('deepseek-v4-flash');
    expect(args.deepThink).toBe(true);
    expect(args.json).toBe(true);
  });

  it('supports permission-mode alias', () => {
    const args = parseArgs(['--permission-mode', 'plan']);
    expect(args.mode).toBe('plan');
  });
});

