import { describe, expect, it } from 'vitest';
import { parseArgs } from '../args.js';

describe('parseArgs', () => {
  it('parses common flags', () => {
    const args = parseArgs(['--run', 'fix login', '--model', 'deepseek-v4-flash', '--reasoning-effort', 'max', '--json']);
    expect(args.run).toBe('fix login');
    expect(args.model).toBe('deepseek-v4-flash');
    expect(args.reasoningEffort).toBe('max');
    expect(args.json).toBe(true);
  });

  it('supports permission-mode alias', () => {
    const args = parseArgs(['--permission-mode', 'plan']);
    expect(args.mode).toBe('plan');
  });

  it('supports skipping the startup banner', () => {
    expect(parseArgs(['--no-banner']).noBanner).toBe(true);
    expect(parseArgs(['--no-home']).noBanner).toBe(true);
  });

  it('parses the startup theme', () => {
    expect(parseArgs(['--theme', 'neon']).theme).toBe('neon');
  });

  it('parses provider and container sandbox flags', () => {
    expect(parseArgs(['--provider', 'anthropic']).provider).toBe('anthropic');
    expect(parseArgs(['--sandbox', 'container']).sandbox).toBe('container');
  });

  it('parses the max-tokens limit', () => {
    expect(parseArgs(['--max-tokens', '8192']).maxTokens).toBe(8192);
  });

  it('parses --code-file and --code aliases', () => {
    expect(parseArgs(['--code-file', 'main.ts']).code).toBe('main.ts');
    expect(parseArgs(['--code=main.ts']).code).toBe('main.ts');
  });
});
