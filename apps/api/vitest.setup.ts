/**
 * Carrega ../../.env em process.env ANTES de qualquer módulo que chame loadEnv().
 * Roda como setupFile (antes dos imports dos testes).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../../.env', import.meta.url));

try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // sem .env — os testes que precisam de infra vão falhar com mensagem clara
}
