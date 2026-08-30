import { afterEach, describe, expect, it } from 'vitest';
import { runCode } from '../code-runtime.js';

process.env.AURAXIS_ALLOW_UNSAFE_CODE = '1';

afterEach(() => {
  delete process.env.AURAXIS_PYTHON_BIN;
});

describe('runCode', () => {
  it('executes JavaScript in an isolated temp directory', async () => {
    const result = await runCode({ language: 'javascript', code: 'console.log("hello-code");' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello-code');
  });

  it('executes shell snippets and rejects empty code', async () => {
    const result = await runCode({ language: 'shell', code: process.platform === 'win32' ? 'echo hello-shell' : 'echo hello-shell' });
    expect(result.stdout).toContain('hello-shell');
    const empty = await runCode({ language: 'javascript', code: '   ' });
    expect(empty.exitCode).toBe(1);
    expect(empty.stderr).toContain('不能为空');
  });

  it('times out runaway programs', async () => {
    const result = await runCode({
      language: 'javascript',
      code: 'setInterval(() => {}, 1000)',
      timeoutMs: 80,
    });
    expect(result.timedOut).toBe(true);
  });

  it('truncates large output and reports child failures', async () => {
    const big = await runCode({ language: 'javascript', code: 'console.log("x".repeat(60000));' });
    expect(big.truncated).toBe(true);
    expect(big.stdout.length).toBeLessThanOrEqual(50_000);
    const bigError = await runCode({ language: 'javascript', code: 'console.error("x".repeat(60000));' });
    expect(bigError.truncated).toBe(true);
    expect(bigError.stderr.length).toBeLessThanOrEqual(50_000);
    const invalid = await runCode({ language: 'javascript', code: 'throw new Error("boom")' });
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain('boom');
  });

  it('maps typescript aliases to JavaScript and handles missing runtimes', async () => {
    const mapped = await runCode({ language: 'typescript', code: 'console.log("alias-ok")' });
    expect(mapped.stdout).toContain('alias-ok');
    process.env.AURAXIS_PYTHON_BIN = 'auraxis-no-such-python';
    const missing = await runCode({ language: 'python', code: 'print(1)', timeoutMs: 500 });
    expect(missing.exitCode).toBeNull();
  });

  it('honors an abort signal', async () => {
    const controller = new AbortController();
    const pending = runCode({
      language: 'javascript',
      code: 'setInterval(() => {}, 1000)',
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 30);
    const result = await pending;
    expect(result.exitCode).toBeNull();
  });

  it('handles an already-aborted signal and fail-closed packaged mode', async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = await runCode({
      language: 'javascript',
      code: 'setInterval(() => {}, 1000)',
      signal: controller.signal,
      timeoutMs: 5_000,
    });
    expect(aborted.exitCode).toBeNull();
    const old = process.env.AURAXIS_ALLOW_UNSAFE_CODE;
    delete process.env.AURAXIS_ALLOW_UNSAFE_CODE;
    try {
      const disabled = await runCode({ language: 'javascript', code: '1' });
      expect(disabled.exitCode).toBe(1);
      expect(disabled.stderr).toContain('默认禁用');
    } finally {
      if (old === undefined) delete process.env.AURAXIS_ALLOW_UNSAFE_CODE;
      else process.env.AURAXIS_ALLOW_UNSAFE_CODE = old;
    }
  });
});
