import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const valid: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/wpp',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: 'a'.repeat(64),
  SESSION_SECRET: 'b'.repeat(64),
  ALERT_WHATSAPP_NUMBER: '5511999999999',
  ALERT_EMAIL: 'admin@example.com',
};

describe('loadEnv', () => {
  it('valida um ambiente correto e aplica defaults', () => {
    const env = loadEnv(valid);
    expect(env.DEFAULT_DAILY_LIMIT).toBe(300);
    expect(env.RETENTION_DAYS).toBe(90);
    expect(env.API_PORT).toBe(3000);
  });

  it('rejeita ENCRYPTION_KEY com tamanho errado', () => {
    expect(() => loadEnv({ ...valid, ENCRYPTION_KEY: 'short' })).toThrow(/ENCRYPTION_KEY/);
  });

  it('TENANT_TIMEZONE default é UTC', () => {
    expect(loadEnv(valid).TENANT_TIMEZONE).toBe('UTC');
  });

  it('aceita fuso IANA válido (América/Bogotá, América/São_Paulo)', () => {
    expect(loadEnv({ ...valid, TENANT_TIMEZONE: 'America/Bogota' }).TENANT_TIMEZONE).toBe(
      'America/Bogota',
    );
    expect(loadEnv({ ...valid, TENANT_TIMEZONE: 'America/Sao_Paulo' }).TENANT_TIMEZONE).toBe(
      'America/Sao_Paulo',
    );
  });

  it('rejeita TENANT_TIMEZONE inválido', () => {
    expect(() => loadEnv({ ...valid, TENANT_TIMEZONE: 'Nao/Existe' })).toThrow(
      /TENANT_TIMEZONE/,
    );
  });

  it('rejeita DATABASE_URL que não é postgres', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'mysql://x' })).toThrow(
      /Configuração de ambiente/,
    );
  });

  it('rejeita configuração SMTP parcial', () => {
    expect(() => loadEnv({ ...valid, SMTP_HOST: 'smtp.example.com' })).toThrow(/SMTP incompleta/);
  });

  it('aceita configuração SMTP completa', () => {
    const env = loadEnv({
      ...valid,
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'user',
      SMTP_PASSWORD: 'pass',
    });
    expect(env.SMTP_HOST).toBe('smtp.example.com');
  });

  it('PANEL_DEFAULT_LOCALE default é "pt"', () => {
    expect(loadEnv(valid).PANEL_DEFAULT_LOCALE).toBe('pt');
  });

  it('rejeita PANEL_DEFAULT_LOCALE inválido', () => {
    expect(() => loadEnv({ ...valid, PANEL_DEFAULT_LOCALE: 'fr' })).toThrow(
      /PANEL_DEFAULT_LOCALE/,
    );
  });
});
