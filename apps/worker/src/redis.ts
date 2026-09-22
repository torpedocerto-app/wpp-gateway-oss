import { makeStateConnection } from '@wpp/queue';

/**
 * Conexão Redis para o estado do worker (cache onWhatsApp, contadores, locks,
 * cooldown). As conexões do BullMQ são criadas em @wpp/queue.
 */
export const redis = makeStateConnection();

redis.on('error', (err) => {
  // não derruba o processo; o worker tolera Redis intermitente
  console.error('[redis] erro de conexão:', err.message);
});
