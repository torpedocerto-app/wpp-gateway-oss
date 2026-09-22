/**
 * CLI do worker para a Fase 1 — operar sessões sem API HTTP nem painel.
 *
 *   pnpm worker pair <label>              cria conta + pareia por QR no terminal
 *   pnpm worker send <accountId> <num> <texto>   envio direto por uma conta
 *   pnpm worker list                     lista contas e status
 *   pnpm worker logout <accountId>       logout no WhatsApp + apaga credenciais
 */
import qrcode from 'qrcode-terminal';
import { loadEnv } from '@wpp/config';
import { AccountStatus } from '@wpp/shared';
import {
  prisma,
  SETTING_KEYS,
  getSetting,
  setSetting,
  deleteSetting,
  listSettings,
} from '@wpp/database';
import { logger } from './logger.js';
import { Session, SessionManager, sendText, diagnoseSend } from './sessions/index.js';
import { sessionDir } from './sessions/paths.js';
import { createAndEnqueue, outboundQueue, closeQueues } from './queue/index.js';
import { redis } from './redis.js';

const env = loadEnv();

async function cmdPair(label: string): Promise<void> {
  if (!label) throw new Error('uso: pnpm worker pair <label>');

  const account = await prisma.account.create({
    data: {
      label,
      status: AccountStatus.DISCONNECTED,
      sessionPath: '', // preenchido abaixo
      dailyLimit: env.DEFAULT_DAILY_LIMIT,
      hourlyLimit: env.DEFAULT_HOURLY_LIMIT,
      // toda conta nova entra em warmup (doc 04 §1)
      warmupUntil: new Date(Date.now() + env.WARMUP_DAYS * 86_400_000),
    },
  });
  await prisma.account.update({
    where: { id: account.id },
    data: { sessionPath: sessionDir(env.SESSIONS_PATH, account.id) },
  });

  console.log(`\n  Conta criada: ${account.id} ("${label}")`);
  console.log(`  Warmup até: ${new Date(Date.now() + env.WARMUP_DAYS * 86_400_000).toISOString()}`);
  console.log('  Aguardando QR...\n');

  await new Promise<void>((resolve, reject) => {
    const session = new Session(account.id, env.SESSIONS_PATH, {
      onQr: (_id, qr, attempt) => {
        console.clear();
        console.log(`  QR ${attempt}/5 — escaneie com o WhatsApp do celular:\n`);
        qrcode.generate(qr, { small: true });
        console.log('\n  (renova sozinho a cada ~20s; expira após 5 tentativas)');
      },
      onConnected: (_id, phone) => {
        console.log(`\n  ✅ Conectado como +${phone}`);
        console.log('  Sessão salva. Pode encerrar (Ctrl+C).\n');
        resolve();
      },
      onTerminal: (_id, reason) => {
        reject(new Error(`pareamento terminou sem conectar: ${reason}`));
      },
    });
    session.start().catch(reject);
  });
}

async function cmdSend(accountId: string, number: string, text: string): Promise<void> {
  if (!accountId || !number || !text) {
    throw new Error('uso: pnpm worker send <accountId> <numero> <texto>');
  }

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new Error(`conta ${accountId} não existe`);
  if (account.status !== AccountStatus.CONNECTED) {
    console.log(`  ⚠️  conta está ${account.status}, tentando conectar mesmo assim...`);
  }

  const session = new Session(accountId, env.SESSIONS_PATH);
  await session.start();

  // aguarda o handshake COMPLETO (evento connection:'open'), não só o WebSocket
  console.log('  aguardando sessão ficar pronta...');
  await session.waitUntilReady(45_000);

  const result = await sendText(session, number, text);
  console.log('\n  Resultado:', JSON.stringify(result, null, 2));

  if (result.ok) {
    console.log('\n  aguardando ack de entrega do WhatsApp (até 15s)...');
    const ack = await session.waitForAck(result.whatsappMessageId!, 15_000);
    console.log(`  ack: ${ack}`);
  }

  await session.stop();
  if (!result.ok) process.exitCode = 1;
}

async function cmdList(): Promise<void> {
  const accounts = await prisma.account.findMany({ orderBy: { createdAt: 'asc' } });
  if (accounts.length === 0) {
    console.log('  (nenhuma conta) — crie uma com: pnpm worker pair <label>');
    return;
  }
  console.log('\n  ID                                    STATUS        NÚMERO           LABEL');
  for (const a of accounts) {
    console.log(
      `  ${a.id}  ${a.status.padEnd(12)}  ${(a.phoneNumber ?? '—').padEnd(15)}  ${a.label}`,
    );
  }
  console.log();
}

async function cmdLogout(accountId: string): Promise<void> {
  if (!accountId) throw new Error('uso: pnpm worker logout <accountId>');
  const mgr = new SessionManager(env.SESSIONS_PATH);
  await mgr.spawn(accountId).catch(() => undefined);
  await mgr.remove(accountId);
  await prisma.account.update({
    where: { id: accountId },
    data: { status: AccountStatus.DISCONNECTED, isEnabled: false },
  });
  console.log(`  conta ${accountId} deslogada e credenciais apagadas`);
}

/** Enfileira uma mensagem (não envia direto) — testa o caminho da Fase 2. */
async function cmdEnqueue(number: string, text: string): Promise<void> {
  if (!number || !text) throw new Error('uso: pnpm worker enqueue <numero> <texto>');
  const project = await prisma.project.findFirst({ where: { slug: 'exemplo' } });
  const result = await createAndEnqueue({
    projectId: project?.id ?? null,
    to: number,
    text,
    externalId: `cli-${Date.now()}`,
  });
  console.log('  enfileirado:', JSON.stringify(result, null, 2));
  console.log('  → o worker (pnpm --filter @wpp/worker dev) processa a fila');
}

async function cmdQueueStatus(): Promise<void> {
  const q = outboundQueue();
  const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
  console.log('  fila outbound:', JSON.stringify(counts, null, 2));
}

/** Envio instrumentado para investigar "Aguardando mensagem" no destinatário. */
async function cmdDiagnose(accountId: string, number: string, text: string): Promise<void> {
  if (!accountId || !number || !text) {
    throw new Error('uso: pnpm worker diagnose <accountId> <numero> <texto>');
  }
  const session = new Session(accountId, env.SESSIONS_PATH);
  await session.start();
  console.log('  aguardando sessão ficar pronta...');
  await session.waitUntilReady(45_000);
  await diagnoseSend(session, number, text);
  await session.stop();
}

/**
 * Gerencia configurações editáveis em runtime (tabela `settings`, Fase 5).
 *   settings list
 *   settings get <chave>
 *   settings set <chave> <valor>
 *   settings unset <chave>
 *
 * Chave principal: alert_whatsapp_number (número que recebe os alertas).
 */
async function cmdSettings(sub: string, key: string, value: string): Promise<void> {
  const known = Object.values(SETTING_KEYS);

  if (sub === 'list') {
    const rows = await listSettings();
    if (rows.length === 0) {
      console.log('  (nenhum setting no banco — valem os defaults do .env)');
    } else {
      for (const r of rows) console.log(`  ${r.key} = ${r.value}  (atualizado ${r.updatedAt.toISOString()})`);
    }
    console.log(`\n  chaves conhecidas: ${known.join(', ')}`);
    return;
  }

  if (sub === 'get') {
    if (!key) throw new Error('uso: settings get <chave>');
    const v = await getSetting(key);
    console.log(v === null ? `  ${key}: (não definido — vale o default do .env)` : `  ${key} = ${v}`);
    return;
  }

  if (sub === 'set') {
    if (!key || !value) throw new Error('uso: settings set <chave> <valor>');
    if (!known.includes(key as (typeof known)[number])) {
      console.log(`  ⚠️  chave "${key}" não é conhecida. Conhecidas: ${known.join(', ')}`);
    }
    if (key === SETTING_KEYS.ALERT_WHATSAPP_NUMBER && !/^\d{10,15}$/.test(value)) {
      throw new Error('alert_whatsapp_number deve ser E.164 sem "+" (ex: 573001234567)');
    }
    await setSetting(key, value);
    console.log(`  ✓ ${key} = ${value}`);
    return;
  }

  if (sub === 'unset') {
    if (!key) throw new Error('uso: settings unset <chave>');
    await deleteSetting(key);
    console.log(`  ✓ ${key} removido (volta a valer o default do .env)`);
    return;
  }

  console.log('  uso: settings <list|get|set|unset> [chave] [valor]');
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'pair':
      await cmdPair(args[0] ?? '');
      break;
    case 'send':
      await cmdSend(args[0] ?? '', args[1] ?? '', args.slice(2).join(' '));
      break;
    case 'enqueue':
      await cmdEnqueue(args[0] ?? '', args.slice(1).join(' '));
      break;
    case 'diagnose':
      await cmdDiagnose(args[0] ?? '', args[1] ?? '', args.slice(2).join(' '));
      break;
    case 'queue:status':
      await cmdQueueStatus();
      break;
    case 'settings':
      await cmdSettings(args[0] ?? '', args[1] ?? '', args.slice(2).join(' '));
      break;
    case 'list':
      await cmdList();
      break;
    case 'logout':
      await cmdLogout(args[0] ?? '');
      break;
    default:
      console.log(
        'comandos: pair <label> | send <accountId> <num> <texto> | enqueue <num> <texto> | ' +
          'diagnose <accountId> <num> <texto> | queue:status | settings <list|get|set|unset> | ' +
          'list | logout <accountId>',
      );
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    logger.error({ err }, 'cli falhou');
    process.exitCode = 1;
  })
  .finally(() => {
    void (async () => {
      await closeQueues();
      await redis.quit().catch(() => undefined);
      await prisma.$disconnect();
      // sessões abertas mantêm o processo vivo; encerra explicitamente
      setTimeout(() => process.exit(process.exitCode ?? 0), 500);
    })();
  });
