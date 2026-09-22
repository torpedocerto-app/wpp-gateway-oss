import nodemailer from 'nodemailer';
import { loadEnv, type Env } from '@wpp/config';

/**
 * Transporte de email via SMTP. Usado pelo worker (fallback de alerta, doc 04
 * §6.2) e pelo painel (recuperação de senha, convite de usuário).
 *
 * SMTP é opcional: sem `SMTP_HOST/USER/PASSWORD` as funções que dependem de
 * email degradam com aviso, não quebram. `loadEnv()` já valida que os três
 * campos vêm juntos ou nenhum.
 *
 * `loadEnv()` é lazy (não no escopo do módulo): o `next build` do painel importa
 * este arquivo em build-time, quando o ambiente ainda não tem as vars.
 */

let _env: Env | null = null;
function env(): Env {
  _env ??= loadEnv();
  return _env;
}

/** `true` se há configuração SMTP completa. */
export function isEmailConfigured(): boolean {
  const e = env();
  return Boolean(e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASSWORD);
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Envia um email. Retorna `false` (sem lançar) se o SMTP não estiver
 * configurado ou o envio falhar — quem chama decide o fallback.
 * O `subject` é prefixado com `[${PANEL_BRAND_NAME}]`.
 */
export async function sendEmail({ to, subject, text, html }: SendEmailInput): Promise<boolean> {
  if (!isEmailConfigured()) {
    console.error('[@wpp/email] SMTP não configurado — email não enviado:', subject);
    return false;
  }
  try {
    const e = env();
    const transport = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_PORT === 465,
      auth: { user: e.SMTP_USER, pass: e.SMTP_PASSWORD },
    });
    await transport.sendMail({
      from: e.SMTP_USER,
      to,
      subject: `[${e.PANEL_BRAND_NAME}] ${subject}`,
      text,
      ...(html ? { html } : {}),
    });
    return true;
  } catch (err) {
    console.error('[@wpp/email] falha ao enviar email:', err);
    return false;
  }
}
