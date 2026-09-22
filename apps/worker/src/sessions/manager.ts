import { prisma } from '@wpp/database';
import { AccountStatus } from '@wpp/shared';
import { logger } from '../logger.js';
import { Session, type SessionEvents } from './session.js';
import { handleInboundUpsert } from './inbound.js';

/** Intervalo do health check (doc 04 §5). */
const HEALTH_CHECK_INTERVAL_MS = 60_000;
/** last_seen_at defasado além disto força reconexão (doc 04 §5). */
const STALE_THRESHOLD_MS = 5 * 60_000;

/**
 * Orquestra todas as sessões WhatsApp do worker.
 *
 * ⚠️ Instância ÚNICA por processo, e um só processo worker (ADR-002). Duas
 * instâncias sobre o mesmo volume de sessões corrompem credenciais.
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private healthTimer: NodeJS.Timeout | null = null;
  /** Eventos aplicados a TODA sessão criada (definidos pelo main antes do bootstrap). */
  private globalEvents: SessionEvents = {};

  constructor(private readonly sessionsPath: string) {}

  /** Registra eventos globais (ex.: alerta em onTerminal). Chamar antes de bootstrap. */
  setGlobalEvents(events: SessionEvents): void {
    this.globalEvents = events;
  }

  /** Sessões vivas no momento. */
  get active(): ReadonlyMap<string, Session> {
    return this.sessions;
  }

  /**
   * Sobe as sessões de todas as contas que não estão banidas nem desativadas.
   * Chamado no boot do worker.
   */
  async bootstrap(): Promise<void> {
    const accounts = await prisma.account.findMany({
      where: { status: { not: AccountStatus.BANNED }, isEnabled: true },
      select: { id: true, label: true },
    });

    logger.info({ count: accounts.length }, 'bootstrap de sessões');
    for (const acc of accounts) {
      await this.spawn(acc.id).catch((err) => {
        logger.error({ err, accountId: acc.id }, 'falha ao subir sessão no bootstrap');
      });
    }

    this.startHealthCheck();
  }

  /** Cria e inicia uma sessão para a conta. Idempotente (ignora se já existe). */
  async spawn(accountId: string, events?: SessionEvents): Promise<Session> {
    const existing = this.sessions.get(accountId);
    if (existing) return existing;

    const merged: SessionEvents = { ...this.globalEvents, ...events };
    const session = new Session(accountId, this.sessionsPath, {
      ...merged,
      onTerminal: (id, reason, decision) => {
        this.sessions.delete(id);
        merged.onTerminal?.(id, reason, decision);
      },
      onInbound: (id, messages) => {
        void handleInboundUpsert(id, messages);
        merged.onInbound?.(id, messages);
      },
    });
    this.sessions.set(accountId, session);
    await session.start();
    return session;
  }

  /** Para uma sessão sem apagar credenciais (doc 04 §7 "Pausar"). */
  async stop(accountId: string): Promise<void> {
    const s = this.sessions.get(accountId);
    if (!s) return;
    await s.stop();
    this.sessions.delete(accountId);
  }

  /** Logout + wipe (doc 04 §7 "Remover"). */
  async remove(accountId: string): Promise<void> {
    const s = this.sessions.get(accountId);
    if (s) {
      await s.logoutAndWipe();
      this.sessions.delete(accountId);
    }
  }

  /** Para tudo (shutdown do worker). */
  async shutdown(): Promise<void> {
    if (this.healthTimer) clearInterval(this.healthTimer);
    await Promise.all([...this.sessions.values()].map((s) => s.stop()));
    this.sessions.clear();
  }

  // ── Health check (doc 04 §5) ─────────────────────────────────────────────

  private startHealthCheck(): void {
    this.healthTimer = setInterval(() => void this.runHealthCheck(), HEALTH_CHECK_INTERVAL_MS);
  }

  private async runHealthCheck(): Promise<void> {
    const connected = await prisma.account.findMany({
      where: { status: AccountStatus.CONNECTED },
      select: { id: true, lastSeenAt: true },
    });

    for (const acc of connected) {
      const session = this.sessions.get(acc.id);

      // 1. Estado 'CONNECTED' no banco mas sem sessão viva → inconsistência
      if (!session) {
        logger.warn({ accountId: acc.id }, 'conta CONNECTED sem sessão — respawn');
        await this.spawn(acc.id).catch(() => undefined);
        continue;
      }

      // 2. Socket aberto? (doc 04 §5.1)
      if (!session.isOpen) {
        logger.warn({ accountId: acc.id }, 'socket não está OPEN — forçando reconexão');
        await session.stop();
        this.sessions.delete(acc.id);
        await this.spawn(acc.id).catch(() => undefined);
        continue;
      }

      // 3. last_seen_at defasado? (doc 04 §5.3)
      const stale =
        acc.lastSeenAt !== null && Date.now() - acc.lastSeenAt.getTime() > STALE_THRESHOLD_MS;
      if (stale) {
        logger.warn({ accountId: acc.id }, 'last_seen_at defasado > 5min — forçando reconexão');
        await session.stop();
        this.sessions.delete(acc.id);
        await this.spawn(acc.id).catch(() => undefined);
        continue;
      }

      // 4. Heartbeat OK
      await prisma.account.update({
        where: { id: acc.id },
        data: { lastSeenAt: new Date() },
      });
    }
  }
}
