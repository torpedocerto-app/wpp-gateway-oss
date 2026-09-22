/**
 * Sorteio ponderado de conta para envio (doc 05 §2).
 *
 * O sorteio é ALEATÓRIO PONDERADO, não round-robin: round-robin (A→B→C→A→B→C)
 * é um padrão previsível que a Meta pode correlacionar entre números.
 *
 * Funções puras — recebem um snapshot do estado, não tocam banco nem Redis.
 * O worker monta o snapshot (Fase 2) e chama estas funções.
 */

/** Snapshot do estado de uma conta no momento do sorteio. */
export interface AccountSnapshot {
  id: string;
  status: string; // AccountStatus
  isEnabled: boolean;
  socketOpen: boolean;
  priority: number;
  dailyLimit: number;
  hourlyLimit: number;
  sentToday: number;
  sentThisHour: number;
  /** epoch ms do último envio bem-sucedido, ou null se nunca enviou. */
  lastSendAt: number | null;
  /** taxa de DELIVERED nas últimas ~50 mensagens (0..1). null = sem histórico. */
  recentDeliveryRate: number | null;
  /** true enquanto a conta está em warmup (doc 06 §2.2). */
  inWarmup: boolean;
  /** true se está em quarentena por heurística de shadow-ban (doc 04 §4). */
  quarantined: boolean;
  /** true se o lock Redis da conta está tomado (já enviando). */
  locked: boolean;
  /** true se ainda está no intervalo mínimo entre envios (cooldown). */
  inCooldown: boolean;
}

/** Motivo pelo qual uma conta foi excluída do sorteio (para diagnóstico). */
export type IneligibilityReason =
  | 'not_connected'
  | 'disabled'
  | 'socket_closed'
  | 'hourly_limit'
  | 'daily_limit'
  | 'quarantined'
  | 'cooldown'
  | 'locked';

/**
 * Verifica elegibilidade (doc 05 §2.1). Retorna null se elegível, ou o primeiro
 * motivo de inelegibilidade encontrado.
 */
export function ineligibleReason(a: AccountSnapshot): IneligibilityReason | null {
  if (a.status !== 'CONNECTED') return 'not_connected';
  if (!a.isEnabled) return 'disabled';
  if (!a.socketOpen) return 'socket_closed';
  if (a.sentThisHour >= a.hourlyLimit) return 'hourly_limit';
  if (a.sentToday >= a.dailyLimit) return 'daily_limit';
  if (a.quarantined) return 'quarantined';
  if (a.inCooldown) return 'cooldown';
  if (a.locked) return 'locked';
  return null;
}

export function isEligible(a: AccountSnapshot): boolean {
  return ineligibleReason(a) === null;
}

/** Peso de uma conta no sorteio (doc 05 §2.2). Sempre > 0 para conta elegível. */
export function accountWeight(a: AccountSnapshot, now = Date.now()): number {
  const base = a.priority + 1;

  // Conta quase no limite diário raramente é sorteada.
  const fatorCapacidade = Math.max(0.01, 1 - a.sentToday / a.dailyLimit);

  // Conta com entrega recente ruim é evitada (piso 0.1).
  const fatorSaude = a.recentDeliveryRate === null ? 1 : Math.max(0.1, a.recentDeliveryRate);

  // Distribui no tempo: quanto mais tempo desde o último envio, maior o peso.
  const secondsSinceLast = a.lastSendAt === null ? 300 : (now - a.lastSendAt) / 1000;
  const fatorDescanso = Math.min(1, secondsSinceLast / 300);

  // Conta em warmup recebe pouco tráfego.
  const fatorWarmup = a.inWarmup ? 0.3 : 1.0;

  return base * fatorCapacidade * fatorSaude * fatorDescanso * fatorWarmup;
}

/**
 * Sorteio por roleta ponderada entre as contas elegíveis.
 *
 * @param accounts snapshot de todas as contas do pool
 * @param opts.preferredId se elegível, é escolhido direto (doc 05 §2.3)
 * @param opts.excludeIds contas já tentadas nesta mensagem (fallback, doc 05 §4)
 * @param opts.rng função [0,1) injetável para testes determinísticos
 * @returns id da conta escolhida, ou null se nenhuma elegível
 */
export function selectAccount(
  accounts: AccountSnapshot[],
  opts: {
    preferredId?: string | null;
    excludeIds?: readonly string[];
    rng?: () => number;
    now?: number;
  } = {},
): string | null {
  const { preferredId, excludeIds = [], rng = Math.random, now = Date.now() } = opts;
  const excluded = new Set(excludeIds);

  const pool = accounts.filter((a) => !excluded.has(a.id) && isEligible(a));
  if (pool.length === 0) return null;

  // preferredAccountId: se está no pool elegível, usa direto.
  if (preferredId && pool.some((a) => a.id === preferredId)) {
    return preferredId;
  }

  const weights = pool.map((a) => accountWeight(a, now));
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) {
    // Todas com peso ~0 (ex.: todas no teto de capacidade): escolha uniforme.
    return pool[Math.floor(rng() * pool.length)]!.id;
  }

  let ticket = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    ticket -= weights[i]!;
    if (ticket <= 0) return pool[i]!.id;
  }
  return pool[pool.length - 1]!.id; // guarda contra erro de ponto flutuante
}
