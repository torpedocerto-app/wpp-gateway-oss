import { pino } from 'pino';

/**
 * Logger estruturado (doc 01 §3). JSON em produção, pretty em dev.
 *
 * ⚠️ Redaction obrigatória (doc 08 §7): nunca logar tokens, credenciais de
 * sessão ou conteúdo de mensagem em nível info.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: ['authorization', 'token', 'password', 'secret', '*.authorization', '*.token'],
    censor: '[redacted]',
  },
  ...(process.env.NODE_ENV !== 'production'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
    : {}),
});

export type Logger = typeof logger;

/**
 * Mensagens de erro do Baileys que são RUÍDO conhecido, não indicam problema
 * real de envio/recebimento (doc 05 nota "ruído conhecido"):
 *
 *  - "failed to decrypt message" / "No session record" / "MessageCounterError"
 *    ("Key used already or never filled"): o WhatsApp reenvia notificações
 *    antigas de mensagens próprias (fromMe:true, @lid) ao reconectar; o
 *    contador Signal daquela mensagem já foi consumido. Inofensivo.
 *
 *  - "unexpected error in 'init queries'" / "Timed Out" no fetchProps: as
 *    consultas de inicialização do Baileys (privacidade, blocklist, ABT props,
 *    labels de negócio) às vezes dão timeout. São opcionais — a sessão conecta
 *    e opera normalmente sem elas.
 */
const BAILEYS_NOISE = [
  /failed to decrypt message/i,
  /no session record/i,
  /key used already or never filled/i,
  /messagecountererror/i,
  /init queries/i,
  /executeInitQueries/i,
  /fetchProps|fetchAbtProps|fetchPrivacySettings|fetchBlocklist/i,
];

function isBaileysNoise(obj: unknown, msg?: string): boolean {
  const text = `${msg ?? ''} ${safeStringify(obj)}`;
  return BAILEYS_NOISE.some((re) => re.test(text));
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return String(v);
  }
}

/**
 * Logger para passar ao `makeWASocket`. Rebaixa o ruído conhecido de ERROR
 * (com stack trace) para uma linha curta de WARN, mantendo o resto intacto.
 */
export function baileysLogger(accountId: string): Logger {
  const child = logger.child({ mod: 'baileys', accountId }, { level: 'warn' });
  const origError = child.error.bind(child);

  child.error = function patchedError(obj: unknown, msg?: string, ...rest: unknown[]) {
    if (isBaileysNoise(obj, msg)) {
      // uma linha, sem o stack: você fica sabendo se acontecer muito
      const summary =
        typeof obj === 'string' ? obj : (obj as { message?: string })?.message ?? msg ?? 'ruído';
      child.warn({ baileysNoise: true }, `[baileys ok] ${summary}`);
      return;
    }
    origError(obj, msg, ...rest);
  };

  return child;
}
