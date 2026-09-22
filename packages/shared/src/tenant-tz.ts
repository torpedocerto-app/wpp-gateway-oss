/**
 * Data/hora local do tenant (doc 05 §5, doc 09 §4).
 *
 * O servidor roda em UTC (EC2). Sem isso, a janela de silêncio anti-ban, a
 * virada do limite diário/horário de envio, a cota diária de projeto e o
 * "hoje" do dashboard viram todos à meia-noite/hora **UTC** — errado para
 * qualquer tenant fora de UTC+0 (nova = America/Bogota, acme =
 * America/Sao_Paulo). `TENANT_TIMEZONE` (env, doc 09 §4) fixa o fuso IANA de
 * cada deploy; estas funções puras convertem para os componentes locais sem
 * depender de nenhuma lib externa (usam `Intl.DateTimeFormat`, nativo do Node).
 */

export interface LocalDateParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Componentes (ano/mês/dia/hora) de `date` na hora local de `timeZone`. */
export function localDateParts(date: Date, timeZone: string): LocalDateParts {
  const parts = formatterFor(timeZone).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // hour12:false + Intl faz "hour" ir de 24 a 0 à meia-noite em algumas locales;
  // normaliza 24 → 0.
  const hour = get('hour') % 24;
  return { year: get('year'), month: get('month'), day: get('day'), hour };
}

/** Hora local (0-23) de `date` no fuso `timeZone`. Substitui `date.getHours()`. */
export function localHour(date: Date, timeZone: string): number {
  return localDateParts(date, timeZone).hour;
}

/** Chave estável "AAAAMMDD" do dia local — para agrupar/expirar contadores por dia. */
export function localDayKey(date: Date, timeZone: string): string {
  const { year, month, day } = localDateParts(date, timeZone);
  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

/** Chave estável "AAAAMMDDHH" da hora local — para agrupar/expirar contadores por hora. */
export function localHourKey(date: Date, timeZone: string): string {
  const { year, month, day, hour } = localDateParts(date, timeZone);
  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}${String(hour).padStart(2, '0')}`;
}

/**
 * Instante UTC correspondente à próxima meia-noite local (00:00 de amanhã no
 * fuso `timeZone`), a partir de `now`. Usado para "quanto falta virar o dia"
 * (cota diária, `Retry-After`).
 */
export function nextLocalMidnightUtc(now: Date, timeZone: string): Date {
  const { year, month, day } = localDateParts(now, timeZone);
  // Busca por aproximação binária o instante UTC cujo dia local ainda é hoje,
  // avançando de hora em hora até virar — simples e robusto a qualquer offset
  // (incl. meio-hora/45min) sem tabela de fusos embutida.
  let candidate = new Date(now);
  for (let i = 0; i < 48; i++) {
    candidate = new Date(candidate.getTime() + 3_600_000);
    const parts = localDateParts(candidate, timeZone);
    if (parts.day !== day || parts.month !== month || parts.year !== year) {
      // achou a hora em que o dia local mudou; refina em minutos até a virada exata
      let refined = new Date(candidate.getTime() - 3_600_000);
      for (let m = 0; m < 60; m++) {
        const next = new Date(refined.getTime() + 60_000);
        const p = localDateParts(next, timeZone);
        if (p.day !== day || p.month !== month || p.year !== year) return next;
        refined = next;
      }
      return candidate;
    }
  }
  // fallback improvável (fuso exótico) — meia-noite UTC do dia seguinte
  const fallback = new Date(now);
  fallback.setUTCHours(24, 0, 0, 0);
  return fallback;
}

/** Segundos (inteiro, arredondado pra cima) até a próxima meia-noite local. */
export function secondsUntilNextLocalMidnight(now: Date, timeZone: string): number {
  return Math.max(0, Math.ceil((nextLocalMidnightUtc(now, timeZone).getTime() - now.getTime()) / 1000));
}

/**
 * Instante UTC correspondente ao início do dia local (00:00 de hoje no fuso
 * `timeZone`) que contém `now`. Para consultas "createdAt >= início de hoje".
 */
export function startOfLocalDayUtc(now: Date, timeZone: string): Date {
  const midnightTomorrow = nextLocalMidnightUtc(now, timeZone);
  // meia-noite de ontem é 24h antes da de amanhã, se `now` já passou da meia-noite
  // de hoje — refina subtraindo 24h e conferindo o dia local.
  let candidate = new Date(midnightTomorrow.getTime() - 24 * 3600_000);
  // ajusta para fusos com DST (nem sempre exatamente 24h) — anda em passos de
  // 1 min até bater o instante em que o dia local mudou de ontem para hoje.
  const todayParts = localDateParts(now, timeZone);
  for (let i = 0; i < 180; i++) {
    const p = localDateParts(candidate, timeZone);
    if (p.year === todayParts.year && p.month === todayParts.month && p.day === todayParts.day) {
      const prevMinute = new Date(candidate.getTime() - 60_000);
      const pp = localDateParts(prevMinute, timeZone);
      if (pp.day !== p.day || pp.month !== p.month || pp.year !== p.year) return candidate;
      candidate = prevMinute;
    } else {
      candidate = new Date(candidate.getTime() + 60_000);
    }
  }
  return candidate;
}

/** Instante UTC correspondente ao início da hora local que contém `now`. */
export function startOfLocalHourUtc(now: Date, timeZone: string): Date {
  const { hour } = localDateParts(now, timeZone);
  let candidate = new Date(now);
  for (let i = 0; i < 60; i++) {
    const prevMinute = new Date(candidate.getTime() - 60_000);
    if (localDateParts(prevMinute, timeZone).hour !== hour) {
      candidate.setUTCSeconds(0, 0);
      return candidate;
    }
    candidate = prevMinute;
  }
  candidate.setUTCSeconds(0, 0);
  return candidate;
}
