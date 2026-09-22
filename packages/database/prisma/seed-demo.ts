/**
 * Seed de DEMONSTRAÇÃO — popula o banco com dados fictícios plausíveis para
 * capturar os screenshots do README (ver docs/SCREENSHOTS.md).
 *
 * NÃO use em produção. Todos os números são fictícios (faixa 5511 9xxxx-xxxx
 * reservada para documentação) e nenhum conteúdo referencia cliente real.
 *
 * Uso:  pnpm --filter @wpp/database exec tsx prisma/seed-demo.ts
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  PrismaClient,
  AccountStatus,
  MessageDirection,
  MessageStatus,
  AttemptResult,
  AccountEventType,
} from '@prisma/client';

const prisma = new PrismaClient();

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

function generateToken() {
  const raw = randomBytes(32)
    .toString('base64url')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 43);
  const plain = `mk_live_${raw}`;
  return { plain, hash: createHash('sha256').update(plain).digest('hex'), prefix: plain.slice(0, 12) };
}

async function main() {
  console.log('→ limpando dados de demo…');
  await prisma.messageAttempt.deleteMany();
  await prisma.accountEvent.deleteMany();
  await prisma.webhookDelivery.deleteMany();
  await prisma.message.deleteMany();
  await prisma.dailyStats.deleteMany();
  await prisma.suppressedContact.deleteMany();
  await prisma.apiToken.deleteMany();
  await prisma.project.deleteMany();
  await prisma.account.deleteMany();

  // ── canais: estados variados, que é o que a screenshot precisa mostrar ────
  const [main1, main2, warm, banned] = await Promise.all([
    prisma.account.create({
      data: {
        label: 'Channel 01',
        phoneNumber: '5511999990001',
        status: AccountStatus.CONNECTED,
        sessionPath: './data/sessions/demo-01',
        priority: 10,
        dailyLimit: 300,
        hourlyLimit: 40,
        connectedAt: daysAgo(34),
        lastSeenAt: minutesAgo(1),
        createdAt: daysAgo(34),
      },
    }),
    prisma.account.create({
      data: {
        label: 'Channel 02',
        phoneNumber: '5511999990002',
        status: AccountStatus.CONNECTED,
        sessionPath: './data/sessions/demo-02',
        priority: 10,
        dailyLimit: 300,
        hourlyLimit: 40,
        connectedAt: daysAgo(21),
        lastSeenAt: minutesAgo(2),
        createdAt: daysAgo(21),
      },
    }),
    prisma.account.create({
      data: {
        label: 'Channel 03',
        phoneNumber: '5511999990003',
        status: AccountStatus.CONNECTED,
        sessionPath: './data/sessions/demo-03',
        priority: 5,
        dailyLimit: 50,
        hourlyLimit: 10,
        connectedAt: daysAgo(3),
        lastSeenAt: minutesAgo(4),
        warmupUntil: new Date(Date.now() + 4 * 86_400_000), // em warmup
        createdAt: daysAgo(3),
      },
    }),
    prisma.account.create({
      data: {
        label: 'Channel 04',
        phoneNumber: '5511999990004',
        status: AccountStatus.BANNED,
        sessionPath: './data/sessions/demo-04',
        isEnabled: false,
        dailyLimit: 300,
        hourlyLimit: 40,
        connectedAt: daysAgo(48),
        lastSeenAt: hoursAgo(19),
        bannedAt: hoursAgo(19),
        lastError: 'loggedOut (401) — session ended by the server',
        consecutiveFailures: 3,
        createdAt: daysAgo(48),
      },
    }),
  ]);
  console.log('✓ 4 canais (2 ativos, 1 em warmup, 1 banido)');

  // ── projetos consumidores ────────────────────────────────────────────────
  const projects = await Promise.all([
    prisma.project.create({
      data: {
        name: 'Storefront',
        slug: 'storefront',
        webhookUrl: 'https://storefront.example.com/hooks/whatsapp',
        webhookEvents: ['message.status', 'message.received'],
        rateLimitPerMinute: 60,
        dailyQuota: 500,
      },
    }),
    prisma.project.create({
      data: {
        name: 'Auth Service',
        slug: 'auth-service',
        webhookUrl: 'https://auth.example.com/hooks/whatsapp',
        webhookEvents: ['message.status'],
        rateLimitPerMinute: 120,
        dailyQuota: 1000,
      },
    }),
    prisma.project.create({
      data: {
        name: 'Internal Monitoring',
        slug: 'monitoring',
        webhookEvents: ['message.status'],
        rateLimitPerMinute: 30,
        dailyQuota: 200,
      },
    }),
  ]);

  const tokens = [];
  for (const [i, p] of projects.entries()) {
    const t = generateToken();
    tokens.push(
      await prisma.apiToken.create({
        data: {
          projectId: p.id,
          name: 'production',
          tokenHash: t.hash,
          tokenPrefix: t.prefix,
          lastUsedAt: minutesAgo(3 + i * 7),
          createdAt: daysAgo(30 - i * 5),
        },
      }),
    );
  }
  console.log('✓ 3 projetos com token');

  // ── mensagens ────────────────────────────────────────────────────────────
  const outbound: Array<[string, string, MessageStatus, number, number]> = [
    // [destino, conteúdo, status, projeto idx, minutos atrás]
    ['+5511988887001', 'Your verification code is 418 302. It expires in 10 minutes.', MessageStatus.READ, 1, 2],
    ['+5511988887002', 'Order #4821 confirmed. Estimated delivery: Thursday.', MessageStatus.DELIVERED, 0, 6],
    ['+5511988887003', 'Your verification code is 771 940. It expires in 10 minutes.', MessageStatus.READ, 1, 11],
    ['+5511988887004', 'Order #4822 has shipped. Tracking: BR8842910277.', MessageStatus.DELIVERED, 0, 18],
    ['+5511988887005', '⚠️ Disk usage on web-02 reached 91%.', MessageStatus.READ, 2, 24],
    ['+5511988887006', 'Your verification code is 205 617. It expires in 10 minutes.', MessageStatus.DELIVERED, 1, 31],
    ['+5511988887007', 'Order #4823 confirmed. Estimated delivery: Friday.', MessageStatus.SENT, 0, 38],
    ['+5511988887008', 'Welcome aboard! Your account is ready to use.', MessageStatus.READ, 0, 47],
    ['+5511988887009', 'Your verification code is 993 128. It expires in 10 minutes.', MessageStatus.DELIVERED, 1, 55],
    ['+5511988887010', 'Payment received for invoice #2291. Thank you.', MessageStatus.DELIVERED, 0, 63],
    ['+5511988887011', '⚠️ Deploy pipeline failed on branch main.', MessageStatus.READ, 2, 74],
    ['+5511988887012', 'Your verification code is 556 043. It expires in 10 minutes.', MessageStatus.FAILED, 1, 82],
    ['+5511988887013', 'Order #4824 confirmed. Estimated delivery: Monday.', MessageStatus.DELIVERED, 0, 95],
    ['+5511988887014', 'Your appointment is tomorrow at 14:30.', MessageStatus.READ, 0, 112],
    ['+5511988887015', 'Your verification code is 330 881. It expires in 10 minutes.', MessageStatus.DELIVERED, 1, 128],
  ];

  const accounts = [main1, main2, warm];
  for (const [i, [to, content, status, pIdx, mins]] of outbound.entries()) {
    const acct = accounts[i % accounts.length];
    const created = minutesAgo(mins);
    const sent = status === MessageStatus.FAILED ? null : new Date(created.getTime() + 2400);

    const msg = await prisma.message.create({
      data: {
        projectId: projects[pIdx].id,
        apiTokenId: tokens[pIdx].id,
        accountId: status === MessageStatus.FAILED ? null : acct.id,
        direction: MessageDirection.OUTBOUND,
        status,
        toNumber: to,
        content,
        attemptCount: status === MessageStatus.FAILED ? 3 : 1,
        queuedAt: created,
        sentAt: sent,
        deliveredAt:
          status === MessageStatus.DELIVERED || status === MessageStatus.READ
            ? new Date(created.getTime() + 5200)
            : null,
        readAt: status === MessageStatus.READ ? new Date(created.getTime() + 41_000) : null,
        failedAt: status === MessageStatus.FAILED ? new Date(created.getTime() + 9400) : null,
        errorCode: status === MessageStatus.FAILED ? 'no_account_available' : null,
        errorMessage:
          status === MessageStatus.FAILED ? 'No channel available after 3 attempts' : null,
        createdAt: created,
      },
    });

    // A mensagem que falhou mostra o fallback: tentou o canal banido antes.
    if (status === MessageStatus.FAILED) {
      await prisma.messageAttempt.create({
        data: {
          messageId: msg.id,
          accountId: banned.id,
          attemptNumber: 1,
          result: AttemptResult.FAILED,
          errorCode: 'connection_closed',
          errorMessage: 'Socket closed before ack',
          durationMs: 3180,
          createdAt: created,
        },
      });
      await prisma.messageAttempt.create({
        data: {
          messageId: msg.id,
          accountId: main2.id,
          attemptNumber: 2,
          result: AttemptResult.FAILED,
          errorCode: 'rate_limited',
          errorMessage: 'Channel hourly limit reached',
          durationMs: 240,
          createdAt: new Date(created.getTime() + 4200),
        },
      });
    } else {
      await prisma.messageAttempt.create({
        data: {
          messageId: msg.id,
          accountId: acct.id,
          attemptNumber: 1,
          result: AttemptResult.SUCCESS,
          durationMs: 1100 + ((i * 137) % 900),
          createdAt: created,
        },
      });
    }
  }

  // Inbound — respostas, incluindo um opt-out
  const inbound: Array<[string, string, number]> = [
    ['+5511988887002', 'thanks!', 9],
    ['+5511988887008', 'got it, thank you', 44],
    ['+5511988887010', 'perfect', 61],
    ['+5511988887014', 'STOP', 105],
  ];
  for (const [from, content, mins] of inbound) {
    await prisma.message.create({
      data: {
        direction: MessageDirection.INBOUND,
        status: MessageStatus.DELIVERED,
        toNumber: main1.phoneNumber!,
        fromNumber: from,
        content,
        accountId: main1.id,
        createdAt: minutesAgo(mins),
      },
    });
  }

  // Volume de fundo do dia corrente: o dashboard conta mensagens de HOJE, então
  // sem isto os cards ficam com números de uma mão só. Distribui ao longo das
  // horas já decorridas, respeitando a janela de silêncio (nada antes das 6h).
  // O dashboard conta "hoje" no fuso do tenant (TENANT_TIMEZONE), não no do
  // processo. Rodando com o servidor em UTC e o tenant em São Paulo, ancorar
  // pelo relógio local do Node joga tudo para o dia anterior do tenant.
  const TZ = process.env.TENANT_TIMEZONE ?? 'America/Sao_Paulo';
  const tzParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date());
  const part = (t: string) => Number(tzParts.find((p) => p.type === t)!.value);
  const tzHour = part('hour') % 24;
  const tzMinute = part('minute');
  const now = new Date();
  const elapsedMin = tzHour * 60 + tzMinute;
  const startMin = 6 * 60; // 06:00, fim da janela de silêncio
  const bulkFiller = [
    'Your verification code is {code}. It expires in 10 minutes.',
    'Order #{n} confirmed. Estimated delivery: Wednesday.',
    'Your appointment is confirmed for {h}:00.',
    'Payment received for invoice #{n}. Thank you.',
  ];
  {
    // Distribui entre 06:00 e o momento atual. Se a captura roda de madrugada
    // (antes das 6h) ainda não há janela útil hoje, então usa o dia inteiro de
    // ontem — o dashboard continua contando "hoje", mas as telas de mensagens
    // ficam populadas de qualquer forma.
    const useToday = elapsedMin > startMin + 30;
    // 06:00 de hoje NO FUSO DO TENANT, convertido para instante absoluto.
    const dayStart = new Date(now.getTime() - (elapsedMin - startMin) * 60_000);
    if (!useToday) dayStart.setTime(dayStart.getTime() - 86_400_000);
    const dayEnd = useToday ? now : new Date(dayStart.getTime() + 15 * 3_600_000);
    const span = Math.max(60, (dayEnd.getTime() - dayStart.getTime()) / 60_000);
    const count = 96;
    const bulk = [];
    for (let i = 0; i < count; i++) {
      const acct = accounts[i % accounts.length];
      const pIdx = i % projects.length;
      const offset = (i / count) * span + ((i * 7) % 11);
      const created = new Date(dayStart.getTime() + offset * 60_000);
      const tpl = bulkFiller[i % bulkFiller.length];
      const content = tpl
        .replace('{code}', String(100_000 + ((i * 48_271) % 899_999)))
        .replace('{n}', String(4600 + i))
        .replace('{h}', String(9 + (i % 9)));
      const status =
        i % 23 === 0 ? MessageStatus.FAILED : i % 3 === 0 ? MessageStatus.DELIVERED : MessageStatus.READ;
      bulk.push({
        projectId: projects[pIdx].id,
        apiTokenId: tokens[pIdx].id,
        accountId: status === MessageStatus.FAILED ? null : acct.id,
        direction: MessageDirection.OUTBOUND,
        status,
        toNumber: `+55119888${String(80_000 + i).slice(-5)}`,
        content,
        attemptCount: 1,
        queuedAt: created,
        sentAt: status === MessageStatus.FAILED ? null : new Date(created.getTime() + 2100),
        deliveredAt:
          status === MessageStatus.FAILED ? null : new Date(created.getTime() + 4800),
        readAt: status === MessageStatus.READ ? new Date(created.getTime() + 38_000) : null,
        failedAt: status === MessageStatus.FAILED ? new Date(created.getTime() + 8200) : null,
        errorCode: status === MessageStatus.FAILED ? 'recipient_not_on_whatsapp' : null,
        errorMessage:
          status === MessageStatus.FAILED ? 'Number has no active WhatsApp account' : null,
        createdAt: created,
      });
    }
    await prisma.message.createMany({ data: bulk });
    console.log(`✓ ${count} mensagens em ${useToday ? 'hoje' : 'ontem'} (volume de fundo)`);
  }

  // Fila: algumas pendentes, para a screenshot de Queue não ficar vazia
  for (let i = 0; i < 3; i++) {
    await prisma.message.create({
      data: {
        projectId: projects[0].id,
        apiTokenId: tokens[0].id,
        direction: MessageDirection.OUTBOUND,
        status: MessageStatus.QUEUED,
        toNumber: `+55119888870${20 + i}`,
        content: `Order #48${30 + i} confirmed. Estimated delivery: Tuesday.`,
        queuedAt: minutesAgo(i),
        createdAt: minutesAgo(i),
      },
    });
  }
  console.log('✓ mensagens (enviadas, recebidas, na fila, 1 com fallback)');

  // ── opt-out ──────────────────────────────────────────────────────────────
  await prisma.suppressedContact.createMany({
    data: [
      { phoneNumber: '+5511988887014', reason: 'opt_out_keyword', createdAt: minutesAgo(105) },
      { phoneNumber: '+5511988887031', reason: 'opt_out_keyword', createdAt: hoursAgo(28) },
      { phoneNumber: '+5511988887042', reason: 'manual', createdAt: daysAgo(4) },
    ],
  });
  console.log('✓ 3 contatos em opt-out');

  // ── eventos de canal ─────────────────────────────────────────────────────
  await prisma.accountEvent.createMany({
    data: [
      { accountId: banned.id, type: AccountEventType.BAN_DETECTED, detail: { statusCode: 401 }, createdAt: hoursAgo(19) },
      { accountId: banned.id, type: AccountEventType.DISCONNECTED, detail: { reason: 'loggedOut' }, createdAt: hoursAgo(19) },
      { accountId: main2.id, type: AccountEventType.RECONNECT_ATTEMPT, detail: { attempt: 1 }, createdAt: hoursAgo(7) },
      { accountId: main2.id, type: AccountEventType.CONNECTED, detail: {}, createdAt: hoursAgo(7) },
      { accountId: warm.id, type: AccountEventType.CONNECTED, detail: {}, createdAt: daysAgo(3) },
      { accountId: main1.id, type: AccountEventType.CONNECTED, detail: {}, createdAt: daysAgo(34) },
    ],
  });

  // ── estatísticas diárias (14 dias, para os gráficos do dashboard) ────────
  const stats = [];
  for (let d = 13; d >= 0; d--) {
    const date = new Date(daysAgo(d).toISOString().slice(0, 10));
    for (const [pi, p] of projects.entries()) {
      const base = [42, 68, 15][pi];
      const wave = Math.round(Math.sin((13 - d) / 2.1 + pi) * base * 0.22);
      const sent = Math.max(4, base + wave + ((d * 7 + pi * 3) % 9));
      const failed = (d + pi) % 6 === 0 ? 1 + (d % 2) : 0;
      const delivered = sent - failed;
      stats.push({
        date,
        projectId: p.id,
        sentCount: sent,
        deliveredCount: delivered,
        readCount: Math.round(delivered * 0.71),
        failedCount: failed,
        receivedCount: Math.round(sent * 0.13),
        errorBreakdown: failed ? { no_account_available: failed } : {},
      });
    }
    for (const a of [main1, main2, warm]) {
      // hoje (d === 0) reflete o volume realmente inserido acima: ~96/3 por canal
      const cap = a.id === warm.id ? 14 : 55;
      if (d === 0) {
        const sent = a.id === warm.id ? 14 : 41;
        stats.push({
          date,
          accountId: a.id,
          sentCount: sent,
          deliveredCount: sent,
          readCount: Math.round(sent * 0.72),
          failedCount: 0,
          receivedCount: Math.round(sent * 0.12),
          errorBreakdown: {},
        });
        continue;
      }
      const sent = Math.max(2, Math.round(cap * (0.55 + ((d * 13) % 40) / 100)));
      stats.push({
        date,
        accountId: a.id,
        sentCount: sent,
        deliveredCount: sent,
        readCount: Math.round(sent * 0.7),
        failedCount: 0,
        receivedCount: Math.round(sent * 0.12),
        errorBreakdown: {},
      });
    }
  }
  await prisma.dailyStats.createMany({ data: stats, skipDuplicates: true });
  console.log(`✓ ${stats.length} linhas de estatística diária (14 dias)`);

  console.log('\nSeed de demonstração concluído.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
