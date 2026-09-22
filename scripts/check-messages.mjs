#!/usr/bin/env node
// Garante que apps/panel/messages/{pt,es,en}.json tenham EXATAMENTE o mesmo
// conjunto de chaves-folha. Roda no CI antes do build do painel.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'panel', 'messages');
const REFERENCE = 'pt';
const OTHERS = ['es', 'en'];

/** Caminhos de todas as folhas de um objeto: {a:{b:1}} -> ['a.b']. */
function leafKeys(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leafKeys(v, path));
    else out.push(path);
  }
  return out;
}

function load(locale) {
  return JSON.parse(readFileSync(join(dir, `${locale}.json`), 'utf8'));
}

const ref = new Set(leafKeys(load(REFERENCE)));
let failed = false;

for (const locale of OTHERS) {
  const keys = new Set(leafKeys(load(locale)));
  const missing = [...ref].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !ref.has(k));
  if (missing.length || extra.length) {
    failed = true;
    console.error(`\n✗ ${locale}.json difere de ${REFERENCE}.json:`);
    for (const k of missing) console.error(`   faltando: ${k}`);
    for (const k of extra) console.error(`   sobrando: ${k}`);
  } else {
    console.log(`✓ ${locale}.json — ${keys.size} chaves, idêntico a ${REFERENCE}.json`);
  }
}

if (failed) {
  console.error('\nTraduções fora de sincronia. Ajuste os arquivos e rode de novo.');
  process.exit(1);
}
console.log('\nTodos os arquivos de mensagem estão em sincronia.');
