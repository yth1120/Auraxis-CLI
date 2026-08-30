import { describe, expect, it } from 'vitest';
import { bashTool } from '../tools/shell.js';
import type { ToolContext } from '../tools/registry.js';

function context(): ToolContext {
  return {
    projectRoot: process.cwd(),
    emit: () => {},
    todos: [],
    setTodos: () => {},
  };
}

describe('shell tool — real process', () => {
  it('runs commands with nested quotes on the platform shell', async () => {
    const output = await bashTool({ command: 'node -e "console.log(42)"' }, context());
    expect(output.content).toContain('42');
  });

  it('captures stdout from a spaced command', async () => {
    const output = await bashTool({ command: 'echo hello world' }, context());
    expect(output.content).toContain('hello world');
  });
});
