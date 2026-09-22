import { Boom } from '@hapi/boom';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
  type ConnectionState,
  type WAMessage,
} from 'baileys';
import {
  classifyDisconnect,
  DisconnectDecision,
  reconnectDelayMs,
  MAX_RECONNECT_ATTEMPTS,
  AccountStatus,
} from '@wpp/shared';
import { prisma } from '@wpp/database';
import { logger, baileysLogger } from '../logger.js';
import { redis } from '../redis.js';
import { ensureSessionDir, wipeSessionDir } from './paths.js';
import { recordAccountEvent } from './events.js';
import {
  acquireSessionOwnership,
  currentSessionOwner,
  type SessionOwnership,
} from './process-lock.js';

/** Máximo de QRs emitidos sem scan antes de abortar o pareamento (doc 04 §1). */
const MAX_QR_EMISSIONS = 5;

/**
 * Status de mensagem do WhatsApp (WAProto.WebMessageInfo.Status).
 * O ack de entrega útil é DELIVERY_ACK (3) ou superior.
 */
export const WaMessageStatus = {
  ERROR: 0,
  PENDING: 1,
  SERVER_ACK: 2,
  DELIVERY_ACK: 3,
  READ: 4,
  PLAYED: 5,
} as const;
export type WaAckLabel = 'error' | 'pending' | 'server_ack' | 'delivery_ack' | 'read' | 'played' | 'timeout';

function ackLabel(status: number | null | undefined): WaAckLabel {
  switch (status) {
    case 0:
      return 'error';
    case 1:
      return 'pending';
    case 2:
      return 'server_ack';
    case 3:
      return 'delivery_ack';
    case 4:
      return 'read';
    case 5:
      return 'played';
    default:
      return 'pending';
  }
}

export interface SessionEvents {
  /** QR novo para exibir (string crua do Baileys). */
  onQr?: (accountId: string, qr: string, attempt: number) => void;
  /** Conectou com sucesso; traz o phone_number normalizado. */
  onConnected?: (accountId: string, phoneNumber: string) => void;
  /** Entrou em estado terminal (BANNED ou DISCONNECTED sem retry). */
  onTerminal?: (accountId: string, reason: string, decision: DisconnectDecision) => void;
  /** Mensagens recebidas (evento `messages.upsert` do Baileys, Fase 4). */
  onInbound?: (accountId: string, messages: WAMessage[]) => void;
}

/**
 * Gerencia UMA sessão WhatsApp (um socket Baileys) e seu ciclo de vida completo:
 * pareamento por QR, conexão, classificação de desconexão (doc 04 §3),
 * reconexão com backoff e persistência de estado em `accounts`.
 *
 * Não sabe nada de fila nem de sorteio — isso é a Fase 2.
 */
export class Session {
  private sock: WASocket | null = null;
  private reconnectAttempts = 0;
  private qrEmissions = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  /** true só depois do evento `connection: 'open'` — handshake completo. */
  private ready = false;
  private readyResolvers: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  /** Lock de processo: garante socket único por conta entre processos. */
  private ownership: SessionOwnership | null = null;

  constructor(
    readonly accountId: string,
    private readonly sessionsPath: string,
    private readonly events: SessionEvents = {},
  ) {}

  get socket(): WASocket | null {
    return this.sock;
  }

  /** `true` se o WebSocket subjacente está aberto (doc 04 §5.1). */
  get isOpen(): boolean {
    return this.sock?.ws?.isOpen === true;
  }

  /**
   * `true` só após o evento `connection: 'open'` — handshake Noise completo e
   * chaves sincronizadas. É o pré-requisito real para enviar mensagens; o
   * WebSocket abre segundos antes disso.
   */
  get isReady(): boolean {
    return this.ready;
  }

  /**
   * Resolve quando a sessão fica pronta para enviar. Rejeita se a sessão entrar
   * em estado terminal (ban, replaced, reconnect esgotado) antes disso.
   */
  waitUntilReady(timeoutMs = 60_000): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyResolvers = this.readyResolvers.filter((r) => r.resolve !== wrappedResolve);
        reject(new Error('timeout aguardando sessão ficar pronta'));
      }, timeoutMs);
      const wrappedResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      const wrappedReject = (e: Error) => {
        clearTimeout(timer);
        reject(e);
      };
      this.readyResolvers.push({ resolve: wrappedResolve, reject: wrappedReject });
    });
  }

  private settleReady(err?: Error): void {
    const resolvers = this.readyResolvers;
    this.readyResolvers = [];
    for (const r of resolvers) {
      if (err) r.reject(err);
      else r.resolve();
    }
  }

  /**
   * Aguarda um ack de entrega (>= DELIVERY_ACK) para a mensagem enviada.
   * Resolve com o rótulo do maior status observado, ou 'timeout' se nada chegou.
   *
   * Ack ≠ "enviou": `sendMessage` retornar sem erro só significa que o Baileys
   * enfileirou. Só o ack confirma que o servidor do WhatsApp aceitou/entregou.
   */
  waitForAck(whatsappMessageId: string, timeoutMs = 15_000): Promise<WaAckLabel> {
    if (!this.sock) return Promise.resolve('timeout');
    let best = -1;

    return new Promise<WaAckLabel>((resolve) => {
      const finish = (label: WaAckLabel) => {
        clearTimeout(timer);
        this.sock?.ev.off('messages.update', onUpdate);
        resolve(label);
      };

      const timer = setTimeout(() => finish(best >= 0 ? ackLabel(best) : 'timeout'), timeoutMs);

      const onUpdate = (updates: { key: { id?: string | null }; update: { status?: number | null } }[]) => {
        for (const u of updates) {
          if (u.key.id !== whatsappMessageId) continue;
          const status = u.update.status;
          if (typeof status === 'number' && status > best) best = status;
          if (best >= WaMessageStatus.DELIVERY_ACK) finish(ackLabel(best));
        }
      };

      this.sock!.ev.on('messages.update', onUpdate);
    });
  }

  /** Abre o socket. Se não houver credenciais, inicia pareamento por QR. */
  async start(): Promise<void> {
    this.stopped = false;

    // Lock de processo: se outro processo já tem o socket desta conta, NÃO abrir
    // — dois sockets no mesmo número causam conflict 440 e churn de reconexão.
    if (!this.ownership) {
      this.ownership = await acquireSessionOwnership(redis, this.accountId);
      if (!this.ownership) {
        const owner = await currentSessionOwner(redis, this.accountId);
        throw new Error(
          `sessão ${this.accountId} já está aberta em outro processo (dono: ${owner ?? '?'}). ` +
            `Encerre o outro worker/CLI antes de abrir esta sessão.`,
        );
      }
    }

    const dir = await ensureSessionDir(this.sessionsPath, this.accountId);
    const { state, saveCreds } = await useMultiFileAuthState(dir);

    // `state.creds.registered` só vira true após o 1º creds.update pós-load.
    // A presença do arquivo creds.json com um `me` preenchido é o sinal fiável
    // de que já houve pareamento.
    const hasCreds = Boolean(state.creds.me?.id);
    logger.info(
      { accountId: this.accountId, hasCreds },
      hasCreds ? 'reconectando sessão existente' : 'iniciando pareamento (aguardando QR)',
    );

    this.sock = makeWASocket({
      auth: state,
      // Logger do Baileys em nível warn, com o ruído de descriptografia de
      // reconexão rebaixado para debug (ver logger.ts).
      logger: baileysLogger(this.accountId),
      printQRInTerminal: false, // renderizamos nós mesmos, via onQr
      markOnlineOnConnect: false, // não anuncia presença ao só conectar (anti-ban)
      syncFullHistory: false,
    });

    this.sock.ev.on('creds.update', () => void saveCreds());
    this.sock.ev.on('connection.update', (u) => void this.onConnectionUpdate(u));

    // Inbound (Fase 4): só o tipo 'notify' são mensagens novas em tempo real;
    // 'append' e 'prepend' são sincronização de histórico e devem ser ignorados.
    this.sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      this.events.onInbound?.(this.accountId, messages);
    });
  }

  /** Para a sessão de forma limpa, sem apagar credenciais. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.sock?.end(undefined);
    } catch {
      // socket já morto
    }
    this.sock = null;
    if (this.ownership) {
      await this.ownership.release().catch(() => undefined);
      this.ownership = null;
    }
  }

  /** Logout explícito no WhatsApp + apaga credenciais (doc 04 §7 "Remover"). */
  async logoutAndWipe(): Promise<void> {
    this.stopped = true;
    try {
      await this.sock?.logout();
    } catch (err) {
      logger.warn({ err, accountId: this.accountId }, 'logout falhou (conta talvez já banida)');
    }
    await this.stop();
    await wipeSessionDir(this.sessionsPath, this.accountId);
  }

  private async onConnectionUpdate(u: Partial<ConnectionState>): Promise<void> {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      await this.handleQr(qr);
      return;
    }

    if (connection === 'open') {
      await this.handleOpen();
      return;
    }

    if (connection === 'close') {
      await this.handleClose(lastDisconnect?.error);
      return;
    }
  }

  private async handleQr(qr: string): Promise<void> {
    this.qrEmissions += 1;

    if (this.qrEmissions > MAX_QR_EMISSIONS) {
      logger.warn(
        { accountId: this.accountId, emissions: this.qrEmissions },
        'QR não escaneado após 5 emissões — abortando pareamento',
      );
      await this.setStatus(AccountStatus.DISCONNECTED);
      await recordAccountEvent(this.accountId, 'DISCONNECTED', { reason: 'qr_timeout' });
      await this.stop();
      this.settleReady(new Error('QR não escaneado — pareamento abortado'));
      this.events.onTerminal?.(this.accountId, 'qr_timeout', DisconnectDecision.REPLACED);
      return;
    }

    await this.setStatus(AccountStatus.QR_PENDING);
    await recordAccountEvent(this.accountId, 'QR_GENERATED', { attempt: this.qrEmissions });
    this.events.onQr?.(this.accountId, qr, this.qrEmissions);
  }

  private async handleOpen(): Promise<void> {
    this.reconnectAttempts = 0;
    this.qrEmissions = 0;

    const rawId = this.sock?.user?.id ?? '';
    // sock.user.id vem como "5511999998888:12@s.whatsapp.net" — extrai só o número.
    const phoneNumber = rawId.split(':')[0]?.split('@')[0] ?? null;

    await prisma.account.update({
      where: { id: this.accountId },
      data: {
        status: AccountStatus.CONNECTED,
        phoneNumber,
        connectedAt: new Date(),
        lastSeenAt: new Date(),
        consecutiveFailures: 0,
        lastError: null,
      },
    });
    await recordAccountEvent(this.accountId, 'CONNECTED', { phoneNumber });
    logger.info({ accountId: this.accountId, phoneNumber }, 'sessão conectada');

    this.ready = true;
    this.settleReady();

    if (phoneNumber) this.events.onConnected?.(this.accountId, phoneNumber);
  }

  private async handleClose(error: Error | undefined): Promise<void> {
    if (this.stopped) return; // stop() intencional, não reagir

    this.ready = false;

    const statusCode =
      error instanceof Boom
        ? error.output?.statusCode
        : (error as { output?: { statusCode?: number } })?.output?.statusCode;
    const c = classifyDisconnect(statusCode);

    logger.warn(
      { accountId: this.accountId, statusCode, reason: c.reason, decision: c.decision },
      'conexão fechada',
    );

    switch (c.decision) {
      case DisconnectDecision.BANNED: {
        await this.setStatus(AccountStatus.BANNED, `${c.reason} (${statusCode ?? '?'})`);
        await prisma.account.update({
          where: { id: this.accountId },
          data: { bannedAt: new Date() },
        });
        await recordAccountEvent(this.accountId, 'BAN_DETECTED', {
          reason: c.reason,
          statusCode,
        });
        if (c.wipeCredentials) await wipeSessionDir(this.sessionsPath, this.accountId);
        await this.stop();
        this.settleReady(new Error(`sessão banida: ${c.reason}`));
        this.events.onTerminal?.(this.accountId, c.reason, c.decision);
        return;
      }

      case DisconnectDecision.REPLACED: {
        await this.setStatus(AccountStatus.DISCONNECTED, `${c.reason} (440)`);
        await recordAccountEvent(this.accountId, 'DISCONNECTED', { reason: c.reason });
        await this.stop();
        this.settleReady(new Error('sessão assumida por outro dispositivo'));
        this.events.onTerminal?.(this.accountId, c.reason, c.decision);
        return;
      }

      case DisconnectDecision.RECONNECT_NOW:
        await this.scheduleReconnect(0);
        return;

      case DisconnectDecision.RECONNECT_BACKOFF:
        await this.scheduleReconnect(this.reconnectAttempts);
        return;
    }
  }

  private async scheduleReconnect(attemptsMade: number): Promise<void> {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error(
        { accountId: this.accountId, attempts: this.reconnectAttempts },
        'esgotou tentativas de reconexão — removendo do pool',
      );
      await this.setStatus(AccountStatus.DISCONNECTED, 'reconnect_exhausted');
      await recordAccountEvent(this.accountId, 'DISCONNECTED', {
        reason: 'reconnect_exhausted',
        attempts: this.reconnectAttempts,
      });
      await this.stop();
      this.settleReady(new Error('reconexão esgotada'));
      this.events.onTerminal?.(
        this.accountId,
        'reconnect_exhausted',
        DisconnectDecision.RECONNECT_BACKOFF,
      );
      return;
    }

    const delay = reconnectDelayMs(attemptsMade);
    this.reconnectAttempts += 1;
    await this.setStatus(AccountStatus.RECONNECTING);
    await recordAccountEvent(this.accountId, 'RECONNECT_ATTEMPT', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    });
    logger.info(
      { accountId: this.accountId, attempt: this.reconnectAttempts, delayMs: delay },
      'agendando reconexão',
    );

    this.reconnectTimer = setTimeout(() => {
      void this.start().catch((err) => {
        logger.error({ err, accountId: this.accountId }, 'falha ao reiniciar sessão');
        void this.scheduleReconnect(this.reconnectAttempts);
      });
    }, delay);
  }

  private async setStatus(status: AccountStatus, lastError?: string): Promise<void> {
    await prisma.account.update({
      where: { id: this.accountId },
      data: { status, ...(lastError !== undefined ? { lastError } : {}) },
    });
  }
}

export { DisconnectReason };
