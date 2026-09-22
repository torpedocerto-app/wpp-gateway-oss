/**
 * Agendador do job de retenção (doc 02 §3): roda 1x/dia às 03:00 no fuso do
 * tenant — dentro da janela de silêncio, quando não há envio concorrente.
 *
 * Sem dependência de cron externo: o worker é instância única (ADR-002), então
 * um timer interno basta e mantém o job junto do processo que já tem conexão
 * com banco e alertas.
 */
import { loadEnv } from '@wpp/config';
import { logger } from '../logger.js';
import type { AlertService } from '../alerts/index.js';
import { runRetention } from './service.js';

const env = loadEnv();

/** Hora local (fuso do tenant) em que o job roda. */
const RUN_AT_HOUR = 3;
/** Resolução do timer. De pé a cada 15min, executa quando entra na hora alvo. */
const TICK_MS = 15 * 60_000;

/** Hora atual no fuso do tenant. */
function tenantHour(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: env.TENANT_TIMEZONE,
      hour: '2-digit',
      hour12: false,
    }).format(new Date()),
  ) % 24;
}

/** Data local (YYYY-MM-DD) no fuso do tenant — usada para não repetir no mesmo dia. */
function tenantDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: env.TENANT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export class RetentionScheduler {
  private timer: NodeJS.Timeout | null = null;
  /** Último dia (no fuso do tenant) em que o job já rodou. */
  private lastRunDate: string | null = null;
  private running = false;

  constructor(private readonly alerts?: AlertService) {}

  start(): void {
    // Uma passada imediata garante que, se o worker subir num mês sem partição
    // futura (ex.: deploy após longa parada), isso seja corrigido na hora em vez
    // de esperar as 03:00.
    void this.ensurePartitionsOnBoot();

    this.timer = setInterval(() => void this.tick(), TICK_MS);
    logger.info({ hour: RUN_AT_HOUR, tz: env.TENANT_TIMEZONE }, 'retenção: agendador iniciado');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async ensurePartitionsOnBoot(): Promise<void> {
    try {
      const r = await runRetention(this.alerts);
      this.lastRunDate = tenantDate();
      logger.info({ ...r }, 'retenção: execução de boot concluída');
    } catch (err) {
      // runRetention já alertou; não derruba o worker por causa disto.
      logger.error({ err }, 'retenção: execução de boot falhou');
    }
  }

  async tick(): Promise<void> {
    if (this.running) return;

    const today = tenantDate();
    if (this.lastRunDate === today) return;
    if (tenantHour() !== RUN_AT_HOUR) return;

    this.running = true;
    try {
      const r = await runRetention(this.alerts);
      this.lastRunDate = today;
      logger.info({ ...r }, 'retenção: execução diária concluída');
    } catch (err) {
      logger.error({ err }, 'retenção: execução diária falhou');
    } finally {
      this.running = false;
    }
  }
}
