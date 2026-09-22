import { localHour } from './tenant-tz.js';

/**
 * Delays humanizados aplicados antes de cada envio (doc 05 §5).
 *
 * A digitação (`composing`) e o ritmo irregular são o que distingue um cliente
 * automatizado de um humano. Funções puras e injetáveis para teste.
 */

export interface HumanizeConfig {
  /** Janela de silêncio: hora local (0-23) em que só passa mensagem urgente. */
  silentStart: number;
  silentEnd: number;
}

export const DEFAULT_HUMANIZE: HumanizeConfig = {
  silentStart: 23,
  silentEnd: 6,
};

/** Base entre envios da mesma conta: 8–25 s, com jitter de ±30% e pausa rara. */
export function computeSendDelayMs(rng: () => number = Math.random): number {
  const base = 8_000 + rng() * (25_000 - 8_000);
  const jitter = base * (rng() * 0.6 - 0.3); // ±30%
  const pausaLonga = rng() < 0.05 ? 60_000 + rng() * (180_000 - 60_000) : 0;
  return Math.max(1_000, Math.round(base + jitter + pausaLonga));
}

/** Duração da simulação de digitação: len/12 segundos, teto de 8 s. */
export function composingDurationMs(textLength: number): number {
  return Math.min(8_000, Math.round((textLength / 12) * 1_000));
}

/**
 * `true` se agora (hora local) está dentro da janela de silêncio.
 * A janela cruza a meia-noite (ex.: 23→6), por isso a lógica de intervalo.
 */
export function isSilentHour(
  hour: number,
  cfg: HumanizeConfig = DEFAULT_HUMANIZE,
): boolean {
  const { silentStart, silentEnd } = cfg;
  if (silentStart === silentEnd) return false;
  if (silentStart < silentEnd) {
    return hour >= silentStart && hour < silentEnd;
  }
  // janela que cruza a meia-noite
  return hour >= silentStart || hour < silentEnd;
}

/**
 * Decide se um job deve ser adiado por causa da janela de silêncio.
 * Mensagens urgentes passam sempre (doc 05 §5).
 *
 * `timeZone` é o fuso IANA do tenant (`TENANT_TIMEZONE`, doc 09 §4) — a janela
 * é definida em hora LOCAL do tenant, não do servidor (que roda em UTC).
 *
 * @returns ms a esperar até o fim da janela, ou 0 se pode enviar agora
 */
export function silentHourDelayMs(
  now: Date,
  urgent: boolean,
  timeZone: string,
  cfg: HumanizeConfig = DEFAULT_HUMANIZE,
): number {
  if (urgent) return 0;
  const hour = localHour(now, timeZone);
  if (!isSilentHour(hour, cfg)) return 0;

  // Busca minuto a minuto o instante em que a hora local vira `silentEnd`
  // (evita depender de setHours/setDate, que operam no fuso do processo).
  let t = new Date(now);
  for (let i = 0; i < 25 * 60; i++) {
    t = new Date(t.getTime() + 60_000);
    if (localHour(t, timeZone) === cfg.silentEnd) {
      t.setUTCSeconds(0, 0);
      return Math.max(0, t.getTime() - now.getTime());
    }
  }
  return 0; // não deveria acontecer — fuso exótico ou config inconsistente
}
