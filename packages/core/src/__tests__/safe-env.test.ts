import { afterEach, describe, expect, it } from 'vitest';
import { safeProcessEnv, unsafeCodeDisabledMessage, unsafeCodeEnabled } from '../safe-env.js';

const oldKeys = ['AURAXIS_ALLOW_UNSAFE_CODE', 'DEEPSEEK_API_KEY', 'PATH', 'HOME'];
afterEach(() => {
  for (const key of oldKeys) delete process.env[key];
});

describe('safe environment', () => {
  it('never leaks credentials and keeps allowlisted runtime keys', () => {
    process.env.DEEPSEEK_API_KEY = 'sk-secret';
    process.env.PATH = '/usr/bin';
    process.env.HOME = '/home/test';
    const env = safeProcessEnv({ DEEPSEEK_API_KEY: 'override', TERM: 'xterm' });
    expect(env.DEEPSEEK_API_KEY).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/test');
    expect(env.TERM).toBe('xterm');
  });

  it('disables arbitrary code unless explicitly enabled and exposes a clear message', () => {
    delete process.env.AURAXIS_ALLOW_UNSAFE_CODE;
    expect(unsafeCodeEnabled()).toBe(false);
    expect(unsafeCodeDisabledMessage('RunCode')).toContain('默认禁用');
    process.env.AURAXIS_ALLOW_UNSAFE_CODE = '1';
    expect(unsafeCodeEnabled()).toBe(true);
  });
});
