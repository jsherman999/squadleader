import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    exclude: ['**/*.soak.test.ts', '**/node_modules/**'],
    environment: 'node',
    passWithNoTests: true,
  },
});
