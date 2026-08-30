import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**', 'src/index.ts', 'src/ui/blocks.tsx', 'src/ui/app.tsx', 'src/ui/terminal-controller.ts', 'src/ui/wizard.tsx'],
      thresholds: {
        statements: 95,
        branches: 80,
        functions: 90,
        lines: 95,
      },
    },
  },
});
