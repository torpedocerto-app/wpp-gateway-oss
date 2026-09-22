import { defineConfig } from 'prisma/config';

/**
 * Config do Prisma (substitui a chave `prisma` do package.json, deprecada).
 * https://pris.ly/prisma-config
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
