import { describe, expect, it } from 'vitest';
import {
  appendPendingPrompt,
  formatPlan,
  mouseScrollDelta,
  sessionToUiItems,
  takeNextPendingPrompt,
  withdrawPendingPrompt,
} from '../ui/terminal-model.js';

describe('terminal model helpers', () => {
  it('renders plans and converts sessions to UI items', () => {
    expect(formatPlan({ tasks: [{ id: '1', description: 'task', status: 'pending' }] })).toContain('task');
    const items = sessionToUiItems({
      id: 's1',
      projectRoot: '/p',
      model: 'm',
      createdAt: 1,
      updatedAt: 2,
      messages: [
        { role: 'user', content: 'question' },
        { role: 'assistant', content: 'answer', reasoning_content: 'think' },
        { role: 'tool', tool_call_id: 't', name: 'Read', content: 'text' },
      ],
    });
    expect(items.map((item) => item.kind)).toEqual(['user', 'thinking', 'assistant', 'tool']);
  });

  it('parses terminal mouse wheel events', () => {
    expect(mouseScrollDelta('\x1b[<64;1;1M')).toBe(3);
    expect(mouseScrollDelta('\x1b[<65;1;1M')).toBe(-3);
    expect(mouseScrollDelta('\x1b[<0;1;1M input')).toBe(0);
  });

  it('keeps queued prompts ordered and withdrawable', () => {
    const queued = appendPendingPrompt(appendPendingPrompt([], 'first'), 'second');
    expect(queued).toEqual(['first', 'second']);
    expect(takeNextPendingPrompt(queued)).toEqual({ next: 'first', rest: ['second'] });
    expect(withdrawPendingPrompt(queued)).toEqual({ withdrawn: 'second', rest: ['first'] });
    expect(takeNextPendingPrompt([])).toEqual({ rest: [] });
    expect(withdrawPendingPrompt([])).toEqual({ rest: [] });
  });
});
