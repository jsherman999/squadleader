import { defineConfig } from 'vitest/config';

// Long-running bot-vs-bot soak tests (nightly in CI).
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.soak.test.ts'],
    environment: 'node',
    testTimeout: 600_000,
  },
});
