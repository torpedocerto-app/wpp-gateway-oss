import { z } from 'zod';

/**
 * Schema de variáveis de ambiente.
 *
 * Validado na inicialização de cada processo (doc 09 §4): o serviço NÃO sobe
 * com configuração inválida, em vez de falhar silenciosamente em runtime.
 */
/** `true` se a string é um nome de timezone IANA válido (ex.: 'America/Bogota'). */
function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // --- Infra (doc 09 §4) ---
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  REDIS_URL: z.string().url().startsWith('redis://'),

  // --- Fuso horário do tenant (doc 05 §5) ---
  // Nome IANA (ex.: America/Bogota p/ nova, America/Sao_Paulo p/ acme).
  // Decide a hora "local" usada pela janela de silêncio anti-ban, pela virada
  // do limite diário/horário de envio, pela cota diária de projeto e pelo
  // "hoje" do dashboard. O servidor roda em UTC; sem esta var, tudo isso
  // vira à meia-noite/hora UTC — errado para qualquer tenant fora de UTC+0.
  TENANT_TIMEZONE: z
    .string()
    .min(1)
    .default('UTC')
    .refine(isValidTimeZone, 'TENANT_TIMEZONE deve ser um fuso IANA válido (ex.: America/Bogota)'),

  // --- Criptografia (doc 08 §4.2) ---
  // 32 bytes em hex = 64 caracteres. openssl rand -hex 32
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'ENCRYPTION_KEY deve ter 64 hex chars (32 bytes)'),
  SESSION_SECRET: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'SESSION_SECRET deve ter 64 hex chars (32 bytes)'),

  // --- Alertas (doc 04 §6) ---
  ALERT_WHATSAPP_NUMBER: z.string().regex(/^\d{10,15}$/, 'Número E.164 sem o +'),
  ALERT_EMAIL: z.string().email(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),

  // --- Sessões WhatsApp (doc 04 §2) ---
  SESSIONS_PATH: z.string().min(1).default('/data/sessions'),

  // --- Limites anti-ban padrão (doc 06 §2) ---
  DEFAULT_DAILY_LIMIT: z.coerce.number().int().positive().default(300),
  DEFAULT_HOURLY_LIMIT: z.coerce.number().int().positive().default(40),
  WARMUP_DAYS: z.coerce.number().int().nonnegative().default(7),

  // --- Janela de silêncio (doc 05 §5) — hora local 0-23 ---
  SILENT_HOURS_START: z.coerce.number().int().min(0).max(23).default(23),
  SILENT_HOURS_END: z.coerce.number().int().min(0).max(23).default(6),

  // --- Retenção (doc 02 §3) ---
  RETENTION_DAYS: z.coerce.number().int().positive().default(90),

  // --- Portas dos serviços (doc 01 §2) ---
  API_PORT: z.coerce.number().int().positive().default(3000),
  PANEL_PORT: z.coerce.number().int().positive().default(3001),
  INTERNAL_API_PORT: z.coerce.number().int().positive().default(3002),

  // --- API interna worker↔painel (Fase 6) ---
  // Token compartilhado entre worker e painel. NÃO é token de projeto.
  // Gere com: openssl rand -hex 32
  INTERNAL_API_TOKEN: z.string().min(16).optional(),
  // URL da API interna do worker, do ponto de vista do painel.
  WORKER_INTERNAL_URL: z.string().url().default('http://localhost:3002'),

  // --- Auth do painel (doc 08 §3) ---
  // segredo p/ assinar o cookie de sessão. openssl rand -hex 32
  PANEL_SESSION_SECRET: z.string().regex(/^[0-9a-f]{64}$/).optional(),

  // --- White-label (Fase 7) ---
  // O código não referencia nenhuma marca. Estas vars definem a identidade
  // de CADA deploy. Sem elas, tudo cai em defaults genéricos.
  //
  // URL pública do painel — usada nos links e no assunto dos alertas.
  PANEL_PUBLIC_URL: z.string().url().default('http://localhost:3001'),
  // Nome exibido no painel (cabeçalho, título, issuer do 2FA).
  PANEL_BRAND_NAME: z.string().min(1).max(60).default('Gateway'),
  // Idioma padrão do painel e dos e-mails quando o usuário ainda não tem
  // preferência (primeira visita, tela de login sem cookie). Cada usuário
  // escolhe o próprio idioma depois, persistido em admin_users.locale.
  PANEL_DEFAULT_LOCALE: z.enum(['pt', 'es', 'en']).default('pt'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Valida `process.env` e devolve o objeto tipado.
 * Lança um erro legível listando cada variável inválida se algo estiver errado.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuração de ambiente inválida:\n${issues}`);
  }

  // SMTP: se um campo foi informado, todos os obrigatórios precisam estar
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD } = parsed.data;
  const smtpPartial = [SMTP_HOST, SMTP_USER, SMTP_PASSWORD].some(Boolean);
  const smtpComplete = [SMTP_HOST, SMTP_USER, SMTP_PASSWORD].every(Boolean);
  if (smtpPartial && !smtpComplete) {
    throw new Error(
      'Configuração SMTP incompleta: informe SMTP_HOST, SMTP_USER e SMTP_PASSWORD juntos, ' +
        'ou nenhum. O e-mail é o fallback obrigatório de alerta (doc 04 §6.2).',
    );
  }

  return parsed.data;
}
