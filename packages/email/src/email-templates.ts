/**
 * Templates de email do painel. Puros — recebem tudo pronto (a URL já montada
 * pelo caller a partir de `PANEL_PUBLIC_URL`) e devolvem `{ subject, text, html }`.
 *
 * i18n: cada template recebe um `locale` opcional (default 'pt') e escolhe as
 * frases de uma tabela interna. Sem dependência de next-intl — o pacote também é
 * consumido pelo worker.
 */

export type EmailLocale = 'pt' | 'es' | 'en';

export interface EmailBody {
  subject: string;
  text: string;
  html: string;
}

function normalize(locale: string | undefined): EmailLocale {
  return locale === 'es' || locale === 'en' ? locale : 'pt';
}

function layout(brand: string, heading: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;line-height:1.5">
<div style="max-width:520px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 16px">${heading}</h2>
${bodyHtml}
<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0">
<p style="color:#888;font-size:13px">${brand}</p>
</div></body></html>`;
}

const BUTTON = 'background:#3b82f6;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none';

// ── Recuperação de senha ────────────────────────────────────────────────────

interface ResetCopy {
  subject: string;
  intro: (brand: string) => string;
  instructionText: string;
  instructionHtml: string;
  button: string;
  ignore: string;
}

const RESET_COPY: Record<EmailLocale, ResetCopy> = {
  pt: {
    subject: 'Recuperação de senha',
    intro: (b) => `Você (ou alguém) pediu a recuperação de senha do painel ${b}.`,
    instructionText: 'Abra este link para definir uma nova senha (expira em 30 minutos):',
    instructionHtml:
      'Clique no botão para definir uma nova senha. O link expira em <strong>30 minutos</strong>.',
    button: 'Definir nova senha',
    ignore: 'Se não foi você, ignore este email — sua senha continua a mesma.',
  },
  es: {
    subject: 'Recuperación de contraseña',
    intro: (b) => `Tú (o alguien) solicitó la recuperación de contraseña del panel ${b}.`,
    instructionText: 'Abre este enlace para definir una nueva contraseña (caduca en 30 minutos):',
    instructionHtml:
      'Haz clic en el botón para definir una nueva contraseña. El enlace caduca en <strong>30 minutos</strong>.',
    button: 'Definir nueva contraseña',
    ignore: 'Si no fuiste tú, ignora este correo — tu contraseña sigue siendo la misma.',
  },
  en: {
    subject: 'Password recovery',
    intro: (b) => `You (or someone) requested a password recovery for the ${b} panel.`,
    instructionText: 'Open this link to set a new password (expires in 30 minutes):',
    instructionHtml:
      'Click the button to set a new password. The link expires in <strong>30 minutes</strong>.',
    button: 'Set new password',
    ignore: "If this wasn't you, ignore this email — your password is unchanged.",
  },
};

export function resetPasswordEmail({
  brand,
  url,
  locale,
}: {
  brand: string;
  url: string;
  locale?: string;
}): EmailBody {
  const c = RESET_COPY[normalize(locale)];
  const text = [c.intro(brand), '', c.instructionText, url, '', c.ignore].join('\n');
  const html = layout(
    brand,
    c.subject,
    `<p>${c.intro(brand).replace(brand, `<strong>${brand}</strong>`)}</p>
<p>${c.instructionHtml}</p>
<p style="margin:24px 0"><a href="${url}" style="${BUTTON}">${c.button}</a></p>
<p style="color:#888;font-size:13px">${c.ignore}</p>`,
  );
  return { subject: c.subject, text, html };
}

// ── Convite de novo usuário ─────────────────────────────────────────────────

interface InviteCopy {
  subject: (brand: string) => string;
  intro: (inviter: string, brand: string) => string;
  instructionText: string;
  instructionHtml: string;
  button: string;
}

const INVITE_COPY: Record<EmailLocale, InviteCopy> = {
  pt: {
    subject: (b) => `Convite para o painel ${b}`,
    intro: (i, b) => `${i} convidou você para o painel ${b}.`,
    instructionText:
      'Abra este link para criar sua senha e configurar o 2FA (expira em 72 horas):',
    instructionHtml:
      'Clique no botão para criar sua senha e configurar o 2FA. O link expira em <strong>72 horas</strong>.',
    button: 'Aceitar convite',
  },
  es: {
    subject: (b) => `Invitación al panel ${b}`,
    intro: (i, b) => `${i} te invitó al panel ${b}.`,
    instructionText:
      'Abre este enlace para crear tu contraseña y configurar el 2FA (caduca en 72 horas):',
    instructionHtml:
      'Haz clic en el botón para crear tu contraseña y configurar el 2FA. El enlace caduca en <strong>72 horas</strong>.',
    button: 'Aceptar invitación',
  },
  en: {
    subject: (b) => `Invitation to the ${b} panel`,
    intro: (i, b) => `${i} invited you to the ${b} panel.`,
    instructionText: 'Open this link to create your password and set up 2FA (expires in 72 hours):',
    instructionHtml:
      'Click the button to create your password and set up 2FA. The link expires in <strong>72 hours</strong>.',
    button: 'Accept invitation',
  },
};

export function inviteEmail({
  brand,
  url,
  inviterEmail,
  locale,
}: {
  brand: string;
  url: string;
  inviterEmail: string;
  locale?: string;
}): EmailBody {
  const c = INVITE_COPY[normalize(locale)];
  const subject = c.subject(brand);
  const text = [c.intro(inviterEmail, brand), '', c.instructionText, url].join('\n');
  const html = layout(
    brand,
    subject,
    `<p><strong>${inviterEmail}</strong> ${c
      .intro(inviterEmail, brand)
      .replace(`${inviterEmail} `, '')
      .replace(brand, `<strong>${brand}</strong>`)}</p>
<p>${c.instructionHtml}</p>
<p style="margin:24px 0"><a href="${url}" style="${BUTTON}">${c.button}</a></p>`,
  );
  return { subject, text, html };
}
