/**
 * Processo da API pública (doc 03).
 *
 * Recebe requisições HTTP, valida, autentica e enfileira. NUNCA fala com o
 * WhatsApp — isso é o worker. Pode reiniciar livremente (ADR-002).
 */
import { loadEnv } from '@wpp/config';
import { prisma } from '@wpp/database';
import { redis } from './redis.js';
import { buildServer } from './server.js';

const env = loadEnv();

async function main(): Promise<void> {
  const app = await buildServer();

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  app.log.info(`API ouvindo em :${env.API_PORT}`);

  const shutdown = (signal: string) => {
    app.log.info({ signal }, 'encerrando API');
    void (async () => {
      await app.close();
      await redis.quit();
      await prisma.$disconnect();
      process.exit(0);
    })();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('API falhou ao iniciar:', err);
  process.exit(1);
});
