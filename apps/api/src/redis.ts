import { makeStateConnection } from '@wpp/queue';

/** Redis para cache de auth e store do rate-limit. */
export const redis = makeStateConnection();

redis.on('error', (err) => {
  console.error('[redis] erro de conexão:', err.message);
});
