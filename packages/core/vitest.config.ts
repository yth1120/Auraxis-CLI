import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**', 'src/types.ts', 'src/appserver.ts', 'src/sdk.ts', 'src/worktree.ts'],
      thresholds: {
        statements: 82,
        branches: 80,
        functions: 80,
        lines: 88,
      },
    },
  },
});
