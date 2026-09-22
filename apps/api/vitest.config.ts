import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    // NODE_ENV=test → a fila BullMQ usa nome `outbound-test`, isolada da real.
    // Sem isso, um worker de dev consumiria jobs criados pelos testes.
    env: { NODE_ENV: 'test' },
    fileParallelism: false,
  },
});
