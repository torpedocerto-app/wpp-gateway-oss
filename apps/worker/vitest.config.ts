import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['../api/vitest.setup.ts'],
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    fileParallelism: false,
  },
});
