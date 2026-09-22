/**
 * Classificação de motivos de desconexão do Baileys — o coração do sistema
 * (doc 04 §3). Tratar um ban como falha transitória gera reconexões infinitas
 * contra uma conta morta; tratar uma queda de rede como ban descarta uma conta
 * boa. Esta função é a única fonte de verdade dessa decisão.
 *
 * Os códigos são os HTTP-like status do `DisconnectReason` do Baileys
 * (@hapi/boom `output.statusCode`).
 */

export const DisconnectDecision = {
  /** Reconecta imediatamente (reinício normal de protocolo). */
  RECONNECT_NOW: 'RECONNECT_NOW',
  /** Reconecta com backoff exponencial (causa transitória). */
  RECONNECT_BACKOFF: 'RECONNECT_BACKOFF',
  /** Conta banida: → BANNED, apaga credenciais, alerta. NÃO reconecta. */
  BANNED: 'BANNED',
  /** Sessão assumida por outro dispositivo: → DISCONNECTED, alerta. NÃO reconecta, NÃO apaga credenciais. */
  REPLACED: 'REPLACED',
} as const;
export type DisconnectDecision = (typeof DisconnectDecision)[keyof typeof DisconnectDecision];

interface DisconnectClassification {
  decision: DisconnectDecision;
  /** Rótulo legível do motivo, para logs e alertas. */
  reason: string;
  /** Se true, apaga o diretório de credenciais (novo QR será necessário). */
  wipeCredentials: boolean;
  /** Se true, dispara alerta ao admin (doc 04 §6). */
  alert: boolean;
}

/**
 * Mapa código → classificação. Espelha a tabela do doc 04 §3.
 *
 * Códigos do DisconnectReason do Baileys:
 *   loggedOut=401  badSession=500  connectionClosed=428  connectionLost=408
 *   connectionReplaced=440  timedOut=408  restartRequired=515
 *   multideviceMismatch=411  forbidden=403  unavailableService=503
 */
const CLASSIFICATION: Record<number, DisconnectClassification> = {
  401: { decision: DisconnectDecision.BANNED, reason: 'loggedOut', wipeCredentials: true, alert: true },
  403: { decision: DisconnectDecision.BANNED, reason: 'forbidden', wipeCredentials: true, alert: true },
  // badSession (500) NÃO é ban: é o fallback do `getErrorCodeFromStreamError` do
  // Baileys — qualquer <stream:error> sem `code`/`reason` reconhecido (rede
  // instável, servidor derrubando a conexão) vira 500. Tratar como ban apagava
  // credenciais de contas saudáveis. Ban real vem como loggedOut/forbidden.
  500: {
    decision: DisconnectDecision.RECONNECT_BACKOFF,
    reason: 'badSession',
    wipeCredentials: false,
    alert: false,
  },
  411: {
    decision: DisconnectDecision.BANNED,
    reason: 'multideviceMismatch',
    wipeCredentials: true,
    alert: true,
  },
  440: {
    decision: DisconnectDecision.REPLACED,
    reason: 'connectionReplaced',
    wipeCredentials: false,
    alert: true,
  },
  515: {
    decision: DisconnectDecision.RECONNECT_NOW,
    reason: 'restartRequired',
    wipeCredentials: false,
    alert: false,
  },
  428: {
    decision: DisconnectDecision.RECONNECT_BACKOFF,
    reason: 'connectionClosed',
    wipeCredentials: false,
    alert: false,
  },
  408: {
    decision: DisconnectDecision.RECONNECT_BACKOFF,
    reason: 'connectionLost/timedOut',
    wipeCredentials: false,
    alert: false,
  },
  503: {
    decision: DisconnectDecision.RECONNECT_BACKOFF,
    reason: 'unavailableService',
    wipeCredentials: false,
    alert: false,
  },
};

/** Fallback para códigos desconhecidos: reconecta com backoff, sem apagar nada. */
const UNKNOWN: DisconnectClassification = {
  decision: DisconnectDecision.RECONNECT_BACKOFF,
  reason: 'unknown',
  wipeCredentials: false,
  alert: false,
};

export function classifyDisconnect(statusCode: number | undefined): DisconnectClassification {
  if (statusCode === undefined) return UNKNOWN;
  return CLASSIFICATION[statusCode] ?? { ...UNKNOWN, reason: `unknown(${statusCode})` };
}

/**
 * Backoff de reconexão em ms por número de tentativas consecutivas (doc 04 §3.1).
 * Após MAX_RECONNECT_ATTEMPTS sem sucesso, a conta vira DISCONNECTED + alerta.
 */
export const RECONNECT_BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;
export const RECONNECT_BACKOFF_CEILING_MS = 900_000; // 15 min
export const MAX_RECONNECT_ATTEMPTS = 10;

/** Delay da próxima reconexão dado o número de tentativas já feitas (0-based). */
export function reconnectDelayMs(attemptsMade: number): number {
  return RECONNECT_BACKOFF_MS[attemptsMade] ?? RECONNECT_BACKOFF_CEILING_MS;
}
