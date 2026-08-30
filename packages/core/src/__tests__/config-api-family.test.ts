import { afterEach, describe, expect, it } from 'vitest';
import { loadRuntimeConfig } from '../config.js';

afterEach(() => {
  delete process.env.AURAXIS_API_FAMILY;
  delete process.env.AURAXIS_VISION_DETAIL;
  delete process.env.AURAXIS_STRICT_TOOLS;
  delete process.env.AURAXIS_HOME;
});

describe('DeepSeek interface family configuration', () => {
  it('resolves Responses and Anthropic presets for DeepSeek', async () => {
    const responses = await loadRuntimeConfig({ provider: 'deepseek', apiFamily: 'responses' });
    expect(responses.apiFamily).toBe('responses');
    expect(responses.apiBase).toContain('/responses');

    const anthropic = await loadRuntimeConfig({ provider: 'deepseek', apiFamily: 'anthropic' });
    expect(anthropic.apiFamily).toBe('anthropic');
    expect(anthropic.apiBase).toContain('/anthropic/v1/messages');
  });

  it('defaults strict tools, vision detail and family', async () => {
    const config = await loadRuntimeConfig({ provider: 'deepseek' });
    expect(config.apiFamily).toBe('chat');
    expect(config.visionDetail).toBe('auto');
    expect(config.strictTools).toBe(true);

    process.env.AURAXIS_VISION_DETAIL = 'low';
    process.env.AURAXIS_STRICT_TOOLS = '0';
    const overridden = await loadRuntimeConfig({ provider: 'deepseek' });
    expect(overridden.visionDetail).toBe('low');
    expect(overridden.strictTools).toBe(false);
  });
});
