import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Cada package roda seus próprios testes via `pnpm --filter ... test`.
    // Esta config raiz serve para rodar tudo de uma vez a partir do topo.
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
    // testes de contrato da API falam com Postgres/Redis reais
    fileParallelism: false,
  },
});
