import { describe, expect, it } from 'vitest';
import { resetPasswordEmail, inviteEmail } from './email-templates.js';

describe('resetPasswordEmail', () => {
  it('inclui a URL e a marca no texto e no html', () => {
    const url = 'https://wpp.example.com/login/reset/tok123';
    const { subject, text, html } = resetPasswordEmail({ brand: 'Acme', url });
    expect(subject).toBe('Recuperação de senha');
    expect(text).toContain(url);
    expect(text).toContain('Acme');
    expect(text).toContain('30 minutos');
    expect(html).toContain(`href="${url}"`);
  });

  it('locale "en" — assunto e TTL em inglês', () => {
    const url = 'https://wpp.example.com/login/reset/tok';
    const { subject, text } = resetPasswordEmail({ brand: 'Acme', url, locale: 'en' });
    expect(subject).toBe('Password recovery');
    expect(text).toContain('30 minutes');
    expect(text).toContain(url);
    expect(text).toContain('Acme');
  });

  it('locale "es" — assunto e TTL em espanhol', () => {
    const url = 'https://wpp.example.com/login/reset/tok';
    const { subject, text } = resetPasswordEmail({ brand: 'Acme', url, locale: 'es' });
    expect(subject).toBe('Recuperación de contraseña');
    expect(text).toContain('30 minutos');
  });
});

describe('inviteEmail', () => {
  it('inclui quem convidou, a URL e a marca', () => {
    const url = 'https://wpp.example.com/login/setup?token=tok456';
    const { subject, text, html } = inviteEmail({
      brand: 'Acme',
      url,
      inviterEmail: 'chefe@acme.com',
    });
    expect(subject).toContain('Acme');
    expect(text).toContain('chefe@acme.com');
    expect(text).toContain(url);
    expect(text).toContain('72 horas');
    expect(html).toContain(`href="${url}"`);
  });

  it('locale "en" — assunto e TTL em inglês', () => {
    const url = 'https://wpp.example.com/login/setup?token=t';
    const { subject, text } = inviteEmail({ brand: 'Acme', url, inviterEmail: 'boss@acme.com', locale: 'en' });
    expect(subject).toBe('Invitation to the Acme panel');
    expect(text).toContain('72 hours');
    expect(text).toContain('boss@acme.com');
  });

  it('locale "es" — assunto e TTL em espanhol', () => {
    const url = 'https://wpp.example.com/login/setup?token=t';
    const { subject, text } = inviteEmail({ brand: 'Acme', url, inviterEmail: 'jefe@acme.com', locale: 'es' });
    expect(subject).toBe('Invitación al panel Acme');
    expect(text).toContain('72 horas');
  });
});
