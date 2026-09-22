/**
 * Helpers para traduzir tokens de enum/motivo do `@wpp/shared` via as chaves
 * de mensagem `enums.*` / `disconnectReason.*` / `ssrfReason.*` / `sendError.*`.
 *
 * `T` cobre tanto `useTranslations()` (client) quanto `getTranslations()` (server)
 * do next-intl — ambos expõem `(key) => string` e `.has(key)`.
 */
type Translator = {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
};

export const accountStatusLabel = (t: Translator, token: string) =>
  t.has(`enums.AccountStatus.${token}`) ? t(`enums.AccountStatus.${token}`) : token;

export const messageStatusLabel = (t: Translator, token: string) =>
  t.has(`enums.MessageStatus.${token}`) ? t(`enums.MessageStatus.${token}`) : token;

export const messageDirectionLabel = (t: Translator, token: string) =>
  t.has(`enums.MessageDirection.${token}`) ? t(`enums.MessageDirection.${token}`) : token;

export const attemptResultLabel = (t: Translator, token: string) =>
  t.has(`enums.AttemptResult.${token}`) ? t(`enums.AttemptResult.${token}`) : token;

export const accountEventLabel = (t: Translator, token: string) =>
  t.has(`enums.AccountEventType.${token}`) ? t(`enums.AccountEventType.${token}`) : token;

export const webhookDeliveryStatusLabel = (t: Translator, token: string) =>
  t.has(`enums.WebhookDeliveryStatus.${token}`) ? t(`enums.WebhookDeliveryStatus.${token}`) : token;

export const severityLabel = (t: Translator, token: string) =>
  t.has(`enums.severity.${token}`) ? t(`enums.severity.${token}`) : token;

export const disconnectReasonLabel = (t: Translator, token: string) =>
  t.has(`disconnectReason.${token}`) ? t(`disconnectReason.${token}`) : token;

/** `t` deve ser um translator já namespaced em `ssrfReason` (getTranslations('ssrfReason')). */
export const ssrfReasonLabel = (t: Translator, token: string) => (t.has(token) ? t(token) : token);

/** Código de erro de envio → rótulo; cai no código cru se desconhecido. */
export const sendErrorLabel = (t: Translator, code: string | null | undefined) => {
  if (!code) return t('common.none');
  return t.has(`sendError.${code}`) ? t(`sendError.${code}`) : code;
};
