import { mkdir, rm, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Gestão do diretório de credenciais por conta (doc 04 §2).
 *
 * Regras invioláveis:
 *  - um diretório por accountId, sob SESSIONS_PATH
 *  - permissão 0700 (material criptográfico sensível)
 *  - apagar credenciais = novo QR necessário (usar só em ban/regeração)
 */

export function sessionDir(basePath: string, accountId: string): string {
  return resolve(join(basePath, accountId));
}

/** Cria o diretório da sessão com permissão restrita. Idempotente. */
export async function ensureSessionDir(basePath: string, accountId: string): Promise<string> {
  const dir = sessionDir(basePath, accountId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700); // garante a permissão mesmo se o dir já existia
  return dir;
}

/**
 * Apaga o diretório de credenciais de uma conta.
 * ⚠️ Irreversível: a próxima conexão exigirá novo pareamento por QR.
 * Usar apenas em: banimento detectado (doc 04 §3) ou "Regerar QR" (doc 04 §7).
 */
export async function wipeSessionDir(basePath: string, accountId: string): Promise<void> {
  const dir = sessionDir(basePath, accountId);
  await rm(dir, { recursive: true, force: true });
}
