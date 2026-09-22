import type { Session } from './session.js';
import { toJid } from './send.js';
import { logger } from '../logger.js';

/**
 * Envio de diagnóstico — instrumenta TODOS os eventos relevantes do Baileys
 * para entender por que uma mensagem "sai" mas não é entregue (aviso
 * "Aguardando mensagem" no destinatário).
 *
 * Não passa pela fila. Uso pontual via `pnpm worker diagnose <accountId> <num>`.
 */
export async function diagnoseSend(
  session: Session,
  phone: string,
  text: string,
): Promise<void> {
  const sock = session.socket;
  if (!sock) throw new Error('sessão sem socket');
  const jid = toJid(phone);

  const log = (evt: string, data?: unknown) =>
    console.log(`  [${new Date().toISOString().slice(11, 23)}] ${evt}`, data ?? '');

  // ── listeners de diagnóstico ──────────────────────────────────────────────
  sock.ev.on('messaging-history.set', (h) =>
    log('messaging-history.set', { chats: h.chats.length, isLatest: h.isLatest }),
  );
  sock.ev.on('messages.update', (updates) => {
    for (const u of updates) {
      if (u.key.id) log('messages.update', { id: u.key.id, status: u.update.status });
    }
  });
  sock.ev.on('message-receipt.update', (rs) => {
    for (const r of rs) log('message-receipt.update', { id: r.key.id, receipt: r.receipt });
  });
  sock.ev.on('messages.reaction', (r) => log('messages.reaction', r));
  sock.ev.on('presence.update', (p) => log('presence.update', p));

  // ── 1. o número existe no WhatsApp? ──────────────────────────────────────
  log('onWhatsApp: consultando...');
  const results = await sock.onWhatsApp(jid);
  const check = results?.[0];
  log('onWhatsApp: resultado', check);
  if (!check?.exists) {
    log('ABORT: número não está no WhatsApp');
    return;
  }
  const realJid = check.jid;

  // ── 2. estado da sessão Signal com esse contato ─────────────────────────
  const addr = signalAddr(realJid);
  try {
    const before = await sock.authState.keys.get('session', [addr]);
    log('sessão Signal ANTES', { existe: Boolean(before[addr]) });

    // assertSessions força buscar prekey bundle se a sessão não existe/expirou
    const assertSessions = (
      sock as unknown as { assertSessions?: (jids: string[], force: boolean) => Promise<void> }
    ).assertSessions;
    if (assertSessions) {
      await assertSessions([realJid], true);
      log('assertSessions: ok (prekey handshake se necessário)');
    } else {
      log('assertSessions: não disponível nesta versão do Baileys');
    }

    const after = await sock.authState.keys.get('session', [addr]);
    log('sessão Signal DEPOIS', { existe: Boolean(after[addr]) });
  } catch (err) {
    log('assertSessions: ERRO', err instanceof Error ? err.message : err);
  }

  // ── 3. presença + envio ────────────────────────────────────────────────
  log('sendPresenceUpdate: composing');
  await sock.sendPresenceUpdate('composing', realJid);
  await sleep(1500);
  await sock.sendPresenceUpdate('paused', realJid);

  log('sendMessage: enviando...');
  const sent = await sock.sendMessage(realJid, { text });
  log('sendMessage: aceito', { id: sent?.key.id });

  // ── 4. aguarda acks por até 30s ────────────────────────────────────────
  log('aguardando acks (30s)...');
  await sleep(30_000);
  log('fim do diagnóstico');
}

/** Endereço Signal (user.device) usado como chave no auth store. */
function signalAddr(jid: string): string {
  const [user] = jid.split('@');
  return `${user}.0`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export { logger as _diagLogger };
