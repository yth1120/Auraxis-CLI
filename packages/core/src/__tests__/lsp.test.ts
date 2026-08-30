import { describe, expect, it } from 'vitest';
import { LspManager } from '../lsp.js';

describe('LSP', () => {
  it('returns null when no language server is configured', async () => {
    const previous = process.env.AURAXIS_LSP_COMMAND;
    delete process.env.AURAXIS_LSP_COMMAND;
    try {
      expect(await LspManager.fromEnv(process.cwd())).toBeNull();
    } finally {
      if (previous) process.env.AURAXIS_LSP_COMMAND = previous;
    }
  });
});
