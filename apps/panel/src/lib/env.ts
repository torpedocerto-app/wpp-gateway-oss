import { loadEnv, type Env } from '@wpp/config';

/**
 * Env do painel (server-side).
 *
 * O `.env` é um symlink `apps/panel/.env → ../../.env` (raiz do monorepo), então
 * o Next carrega as variáveis automaticamente. Aqui só validamos com Zod, lazy
 * e cacheado (não roda em build-time se o ambiente ainda não tem as vars).
 */

let _env: Env | null = null;

function get(): Env {
  _env ??= loadEnv();
  return _env;
}

export const env = new Proxy({} as Env, {
  get(_t, prop: string) {
    return get()[prop as keyof Env];
  },
});
