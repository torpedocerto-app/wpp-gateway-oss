import { getTranslations } from 'next-intl/server';
import { getSetting, SETTING_KEYS } from '@wpp/database';
import { env } from '@/lib/env';
import { AlertSettingsForm } from './alert-settings-form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [numberOverride, emailOverride] = await Promise.all([
    getSetting(SETTING_KEYS.ALERT_WHATSAPP_NUMBER),
    getSetting(SETTING_KEYS.ALERT_EMAIL),
  ]);
  const t = await getTranslations('settings');

  return (
    <>
      <h1>{t('title')}</h1>
      <p className="subtitle">{t('subtitle')}</p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('alerts')}</h3>
        <p className="muted">{t('alertsHint')}</p>
        <AlertSettingsForm
          currentNumber={numberOverride}
          envNumber={env.ALERT_WHATSAPP_NUMBER}
          currentEmail={emailOverride}
          envEmail={env.ALERT_EMAIL}
        />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{t('envDefaultsReadOnly')}</h3>
        <table>
          <tbody>
            <tr>
              <td className="muted">{t('defaultDailyLimit')}</td>
              <td>{env.DEFAULT_DAILY_LIMIT}</td>
            </tr>
            <tr>
              <td className="muted">{t('defaultHourlyLimit')}</td>
              <td>{env.DEFAULT_HOURLY_LIMIT}</td>
            </tr>
            <tr>
              <td className="muted">{t('warmupDays')}</td>
              <td>{env.WARMUP_DAYS}</td>
            </tr>
            <tr>
              <td className="muted">{t('silentWindow')}</td>
              <td>
                {env.SILENT_HOURS_START}h – {env.SILENT_HOURS_END}h
              </td>
            </tr>
            <tr>
              <td className="muted">{t('retention')}</td>
              <td>{t('retentionDays', { n: env.RETENTION_DAYS })}</td>
            </tr>
            <tr>
              <td className="muted">{t('timezone')}</td>
              <td>{env.TENANT_TIMEZONE}</td>
            </tr>
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12 }}>
          {t('envNote')}
        </p>
      </div>
    </>
  );
}
