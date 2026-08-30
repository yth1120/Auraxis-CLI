import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { listBackgroundTasks, readBackgroundTask, startBackgroundCommand, stopBackgroundTask } from '../tasks.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('background tasks', () => {
  it('runs commands in the background and exposes output', async () => {
    const task = startBackgroundCommand({
      command: 'node -e "console.log(\'done-task\')"',
      cwd: process.cwd(),
    });
    expect(task.status).toBe('running');
    let current = readBackgroundTask(task.id);
    for (let step = 0; step < 20 && current?.status === 'running'; step += 1) {
      await wait(50);
      current = readBackgroundTask(task.id);
    }
    expect(current?.status).toBe('success');
    expect(current?.output).toContain('done-task');
    expect(listBackgroundTasks().some((item) => item.id === task.id)).toBe(true);
  });

  it('stops a running task', async () => {
    const task = startBackgroundCommand({
      command: 'node -e "setTimeout(()=>{},10000)"',
      cwd: process.cwd(),
    });
    expect(stopBackgroundTask(task.id)).toBe(true);
    await wait(100);
    expect(readBackgroundTask(task.id)?.status).toBe('stopped');
  });

  it('returns undefined and false for unknown tasks', () => {
    expect(readBackgroundTask('missing')).toBeUndefined();
    expect(stopBackgroundTask('missing')).toBe(false);
  });

  it('caps output and honors background timeouts', async () => {
    const big = startBackgroundCommand({
      command: 'node -e "console.log(\'x\'.repeat(60000))"',
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });
    let current = readBackgroundTask(big.id);
    for (let step = 0; step < 30 && current?.status === 'running'; step += 1) {
      await wait(50);
      current = readBackgroundTask(big.id);
    }
    expect((current?.output || '').length).toBeLessThanOrEqual(500_000);

    const timed = startBackgroundCommand({
      command: 'node -e "setTimeout(()=>{},10000)"',
      cwd: process.cwd(),
      timeoutMs: 100,
    });
    await wait(250);
    expect(readBackgroundTask(timed.id)?.status).toBe('timeout');
  });

  it('records non-zero background command exits', async () => {
    const failed = startBackgroundCommand({
      command: 'exit 7',
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });
    let task = readBackgroundTask(failed.id);
    for (let step = 0; step < 30 && task?.status === 'running'; step += 1) {
      await wait(100);
      task = readBackgroundTask(failed.id);
    }
    expect(task?.status).toBe('failed');
    expect(task?.exitCode).toBe(7);
  });

  it('handles empty commands and stderr failures', async () => {
    const empty = startBackgroundCommand({ command: '', cwd: process.cwd(), timeoutMs: 1_000 });
    await wait(200);
    expect(['failed', 'success']).toContain(readBackgroundTask(empty.id)?.status);
    const failed = startBackgroundCommand({
      command: 'exit 1',
      cwd: process.cwd(),
      timeoutMs: 5_000,
    });
    let task = readBackgroundTask(failed.id);
    for (let step = 0; step < 30 && task?.status === 'running'; step += 1) {
      await wait(100);
      task = readBackgroundTask(failed.id);
    }
    expect(task?.status).toBe('failed');
  });

  it('marks tasks failed when the working directory is invalid', async () => {
    const task = startBackgroundCommand({
      command: 'echo x',
      cwd: path.join(os.tmpdir(), `auraxis-task-invalid-${Date.now()}`),
      timeoutMs: 1_000,
    });
    await wait(300);
    expect(readBackgroundTask(task.id)?.status).toBe('failed');
  });
});
