import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

/**
 * Normalização de telefone para E.164 (doc 03 §5).
 *
 * A verificação de existência real no WhatsApp (`onWhatsApp()`) é a fonte de
 * verdade final e roda no worker; aqui só garantimos um formato canônico.
 *
 * Estratégia de país:
 *  1. número com "+" → respeitado como está (código de país explícito)
 *  2. número só de dígitos que começa com um código de país conhecido e tem
 *     comprimento plausível → interpretado como internacional (tenta com "+")
 *  3. senão → assume o país padrão (Brasil)
 *
 * Isso permite tanto "11999998888" (BR implícito) quanto "573001234568"
 * (Colômbia, código 57) sem o cliente precisar mandar o "+".
 */

const DEFAULT_COUNTRY: CountryCode = 'BR';

export interface NormalizedPhone {
  /** E.164 com o + (ex.: +5511999998888). */
  e164: string;
  /** Só dígitos, sem + (ex.: 5511999998888) — formato usado no JID do WhatsApp. */
  digits: string;
  country: string | undefined;
}

/**
 * Normaliza um telefone. Lança Error se não for possível.
 * Aceita: "11999998888", "(11) 99999-8888", "+55 11 99999-8888",
 *         "5511999998888", "573001234568".
 */
export function normalizePhone(input: string): NormalizedPhone {
  const raw = input.trim();
  const digitsOnly = raw.replace(/\D/g, '');

  const candidates: Array<{ value: string; country?: CountryCode }> = [];

  if (raw.includes('+')) {
    // código de país explícito
    candidates.push({ value: raw });
  } else {
    // 1. tenta como internacional (com "+"), para pegar números que já trazem
    //    o código de país (ex.: 57..., 1..., 44...)
    candidates.push({ value: `+${digitsOnly}` });
    // 2. tenta como número nacional do país padrão
    candidates.push({ value: digitsOnly, country: DEFAULT_COUNTRY });
  }

  for (const c of candidates) {
    const parsed = parsePhoneNumberFromString(c.value, c.country);
    if (parsed?.isValid()) {
      return {
        e164: parsed.number,
        digits: parsed.number.replace(/^\+/, ''),
        country: parsed.country,
      };
    }
  }

  throw new Error(`telefone inválido: ${input}`);
}

/** Versão que não lança — retorna null em vez de erro. */
export function tryNormalizePhone(input: string): NormalizedPhone | null {
  try {
    return normalizePhone(input);
  } catch {
    return null;
  }
}
