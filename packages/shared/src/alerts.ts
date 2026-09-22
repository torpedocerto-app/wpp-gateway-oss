/**
 * Regras de alerta (doc 04 §6). Funções puras — o AlertService no worker aplica.
 */

export const AlertSeverity = {
  CRITICAL: 'CRITICAL', // 🔴
  HIGH: 'HIGH', // 🟠
  MEDIUM: 'MEDIUM', // 🟡
  INFO: 'INFO', // 🔵
} as const;
export type AlertSeverity = (typeof AlertSeverity)[keyof typeof AlertSeverity];

export const AlertType = {
  ACCOUNT_BANNED: 'ACCOUNT_BANNED',
  ACCOUNT_DISCONNECTED: 'ACCOUNT_DISCONNECTED',
  ACCOUNT_SUSPECT: 'ACCOUNT_SUSPECT',
  ACCOUNT_LIMIT_REACHED: 'ACCOUNT_LIMIT_REACHED',
  POOL_LOW: 'POOL_LOW', // ≤ 1 conta ativa
  POOL_EMPTY: 'POOL_EMPTY', // 0 contas ativas
  QUEUE_BACKED_UP: 'QUEUE_BACKED_UP', // > 500 jobs
  WEBHOOK_FAILING: 'WEBHOOK_FAILING', // falhando há > 1h
  RETENTION_FAILED: 'RETENTION_FAILED', // job de retenção falhou (doc 02 §3)
} as const;
export type AlertType = (typeof AlertType)[keyof typeof AlertType];

/** Canais possíveis para um alerta (doc 04 §6.3). */
export const AlertChannel = {
  WHATSAPP: 'WHATSAPP',
  EMAIL: 'EMAIL',
  PANEL: 'PANEL',
} as const;
export type AlertChannel = (typeof AlertChannel)[keyof typeof AlertChannel];

interface AlertRule {
  severity: AlertSeverity;
  /** Canais alvo, em ordem de preferência. A cadeia de fallback (doc 04 §6.2)
   *  tenta WhatsApp → Email → Panel entre os canais listados. */
  channels: readonly AlertChannel[];
  /** Janela de deduplicação em ms — o mesmo (type, entityId) não repete nesse período. */
  dedupWindowMs: number;
  /** Se true, reenvia periodicamente até ser resolvido (doc 04 §6.4). */
  escalate?: boolean;
  escalateIntervalMs?: number;
}

/** Tabela de regras por tipo de alerta (doc 04 §6.3). */
export const ALERT_RULES: Record<AlertType, AlertRule> = {
  ACCOUNT_BANNED: {
    severity: AlertSeverity.CRITICAL,
    channels: [AlertChannel.WHATSAPP, AlertChannel.EMAIL, AlertChannel.PANEL],
    dedupWindowMs: 60 * 60_000, // 1h
  },
  ACCOUNT_DISCONNECTED: {
    severity: AlertSeverity.HIGH,
    channels: [AlertChannel.WHATSAPP, AlertChannel.EMAIL, AlertChannel.PANEL],
    dedupWindowMs: 60 * 60_000,
  },
  ACCOUNT_SUSPECT: {
    severity: AlertSeverity.MEDIUM,
    channels: [AlertChannel.WHATSAPP, AlertChannel.PANEL],
    dedupWindowMs: 60 * 60_000,
  },
  ACCOUNT_LIMIT_REACHED: {
    severity: AlertSeverity.INFO,
    channels: [AlertChannel.PANEL],
    dedupWindowMs: 6 * 60 * 60_000, // 6h — informativo
  },
  POOL_LOW: {
    severity: AlertSeverity.CRITICAL,
    channels: [AlertChannel.WHATSAPP, AlertChannel.EMAIL, AlertChannel.PANEL],
    dedupWindowMs: 30 * 60_000, // 30min
  },
  POOL_EMPTY: {
    severity: AlertSeverity.CRITICAL,
    // WhatsApp impossível com 0 contas → e-mail é o canal real (doc 04 §6.3)
    channels: [AlertChannel.EMAIL, AlertChannel.PANEL],
    dedupWindowMs: 30 * 60_000,
    escalate: true,
    escalateIntervalMs: 30 * 60_000, // reenvia a cada 30min até resolver
  },
  QUEUE_BACKED_UP: {
    severity: AlertSeverity.HIGH,
    channels: [AlertChannel.WHATSAPP, AlertChannel.PANEL],
    dedupWindowMs: 30 * 60_000,
  },
  WEBHOOK_FAILING: {
    severity: AlertSeverity.MEDIUM,
    channels: [AlertChannel.PANEL, AlertChannel.EMAIL],
    dedupWindowMs: 60 * 60_000,
  },
  RETENTION_FAILED: {
    // Crítico porque a falha mais grave deste job é não criar a partição do mês
    // seguinte: sem ela, TODO INSERT em `messages` falha na virada do mês e o
    // gateway para de aceitar envios. Escala até alguém resolver.
    severity: AlertSeverity.CRITICAL,
    channels: [AlertChannel.WHATSAPP, AlertChannel.EMAIL, AlertChannel.PANEL],
    dedupWindowMs: 6 * 60 * 60_000, // 6h — o job roda 1x/dia
    escalate: true,
    escalateIntervalMs: 6 * 60 * 60_000,
  },
};

/** Chave de deduplicação de um alerta (doc 04 §6.4). */
export function alertDedupKey(type: AlertType, entityId: string | null): string {
  return `alert:sent:${type}:${entityId ?? 'global'}`;
}

/**
 * `true` se, dado o instante do último envio deste alerta, ele deve ser
 * suprimido agora (ainda dentro da janela de dedup).
 */
export function isWithinDedupWindow(
  type: AlertType,
  lastSentAtMs: number | null,
  now = Date.now(),
): boolean {
  if (lastSentAtMs === null) return false;
  return now - lastSentAtMs < ALERT_RULES[type].dedupWindowMs;
}

// ── heurísticas de shadow-ban (doc 04 §4) ─────────────────────────────────

/** Sinais que levam uma conta a QUARENTENA (não a BANNED — só o admin decide). */
export interface AccountHealthSignals {
  /** falhas de envio consecutivas na conta. */
  consecutiveFailures: number;
  /** taxa de DELIVERED nas últimas ~20 mensagens (0..1), ou null se poucas. */
  recentDeliveryRate: number | null;
  /** envios "com sucesso" seguidos sem NENHUM ack de entrega. */
  sentWithoutAck: number;
}

export type QuarantineDecision =
  | { quarantine: false }
  | { quarantine: true; reason: string; durationMs: number };

/** Avalia se a conta deve entrar em quarentena (doc 04 §4). */
export function evaluateAccountHealth(s: AccountHealthSignals): QuarantineDecision {
  // ≥ 5 falhas consecutivas → suspende 30min
  if (s.consecutiveFailures >= 5) {
    return {
      quarantine: true,
      reason: `${s.consecutiveFailures} falhas consecutivas de envio`,
      durationMs: 30 * 60_000,
    };
  }
  // taxa de entrega < 20% em ≥ 20 mensagens
  if (s.recentDeliveryRate !== null && s.recentDeliveryRate < 0.2) {
    return {
      quarantine: true,
      reason: `taxa de entrega ${(s.recentDeliveryRate * 100).toFixed(0)}% (< 20%)`,
      durationMs: 60 * 60_000,
    };
  }
  // 10 envios "ok" sem nenhum ack de entrega
  if (s.sentWithoutAck >= 10) {
    return {
      quarantine: true,
      reason: `${s.sentWithoutAck} envios sem ack de entrega`,
      durationMs: 60 * 60_000,
    };
  }
  return { quarantine: false };
}
