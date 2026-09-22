/**
 * Carrega .env em process.env antes de qualquer módulo que chame loadEnv().
 * Usado pelo vitest raiz (roda todos os pacotes de uma vez).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

try {
  const envPath = fileURLToPath(new URL('./.env', import.meta.url));
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // sem .env — testes que dependem de infra falharão com mensagem clara
}
