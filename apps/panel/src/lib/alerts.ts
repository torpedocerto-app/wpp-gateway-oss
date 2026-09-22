import { prisma } from '@wpp/database';

/**
 * Histórico de alertas para o painel (`/alerts`).
 *
 * O AlertService (Fase 5) grava em `account_events` com type BAN_DETECTED e
 * `detail = { alert, severity, title, body }`. Também há eventos "reais" de ban
 * (`detail.reason`). Unificamos os dois aqui.
 */

export interface AlertRow {
  id: string;
  createdAt: Date;
  accountId: string | null;
  accountLabel: string | null;
  severity: string;
  type: string;
  title: string;
  body: string;
}

export async function listAlerts(limit = 100): Promise<AlertRow[]> {
  const events = await prisma.accountEvent.findMany({
    where: {
      type: { in: ['BAN_DETECTED', 'DISCONNECTED'] },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const accountIds = [...new Set(events.map((e) => e.accountId))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, label: true },
  });
  const label = new Map(accounts.map((a) => [a.id, a.label]));

  return events.map((e) => {
    const d = (e.detail ?? {}) as Record<string, unknown>;
    const isServiceAlert = typeof d.alert === 'string';
    return {
      id: e.id,
      createdAt: e.createdAt,
      accountId: e.accountId,
      accountLabel: label.get(e.accountId) ?? null,
      severity: isServiceAlert ? String(d.severity ?? 'INFO') : e.type === 'BAN_DETECTED' ? 'CRITICAL' : 'HIGH',
      type: isServiceAlert ? String(d.alert) : e.type,
      title: isServiceAlert
        ? String(d.title ?? d.alert)
        : e.type === 'BAN_DETECTED'
          ? `Ban detectado (${String(d.reason ?? '?')})`
          : `Desconectada (${String(d.reason ?? '?')})`,
      body: isServiceAlert ? String(d.body ?? '') : JSON.stringify(d),
    };
  });
}
