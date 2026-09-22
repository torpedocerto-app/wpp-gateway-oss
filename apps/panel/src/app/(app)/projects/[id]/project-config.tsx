'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { updateProjectAction, testWebhookAction } from '@/app/actions/projects';

const EVENTS = ['message.status', 'message.received'];

export function ProjectConfig({
  id,
  webhookUrl,
  hasSecret,
  webhookEvents,
  rateLimitPerMinute,
  dailyQuota,
  isActive,
}: {
  id: string;
  webhookUrl: string | null;
  hasSecret: boolean;
  webhookEvents: string[];
  rateLimitPerMinute: number;
  dailyQuota: number | null;
  isActive: boolean;
}) {
  const t = useTranslations('projects');
  const tCommon = useTranslations('common');
  const [msg, setMsg] = useState<{ error?: string; ok?: boolean } | null>(null);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testing, startTest] = useTransition();

  async function submit(fd: FormData) {
    setMsg(await updateProjectAction(id, fd));
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t('configuration')}</h3>
      <form action={submit}>
        <label htmlFor="webhookUrl">{t('webhookUrl')} (https)</label>
        <input
          id="webhookUrl"
          name="webhookUrl"
          type="url"
          defaultValue={webhookUrl ?? ''}
          placeholder={t('webhookUrlPlaceholder')}
        />

        <label htmlFor="webhookSecret">
          {t('webhookSecret')} {hasSecret ? t('webhookSecretSet') : t('webhookSecretUnset')}
        </label>
        <input id="webhookSecret" name="webhookSecret" type="password" placeholder="whsec_…" />

        {webhookUrl && hasSecret && (
          <div className="row mt-16" style={{ alignItems: 'center' }}>
            <button
              type="button"
              disabled={testing}
              onClick={() =>
                startTest(async () => {
                  const r = await testWebhookAction(id);
                  setTestMsg(r.message);
                })
              }
            >
              {testing ? t('testing') : t('testWebhook')}
            </button>
            {testMsg && <span className="muted">{testMsg}</span>}
          </div>
        )}

        <label>{t('eventsSubscribed')}</label>
        <div className="row" style={{ gap: 16 }}>
          {EVENTS.map((e) => (
            <label key={e} style={{ display: 'flex', gap: 6, margin: 0 }}>
              <input
                type="checkbox"
                name="events"
                value={e}
                defaultChecked={webhookEvents.includes(e)}
                style={{ width: 'auto' }}
              />
              {e}
            </label>
          ))}
        </div>

        <div className="row" style={{ gap: 16, alignItems: 'flex-end' }}>
          <div>
            <label htmlFor="rateLimitPerMinute">{t('rateLimitPerMinute')}</label>
            <input
              id="rateLimitPerMinute"
              name="rateLimitPerMinute"
              type="number"
              defaultValue={rateLimitPerMinute}
              style={{ width: 120 }}
            />
          </div>
          <div>
            <label htmlFor="dailyQuota">{t('dailyQuota')}</label>
            <input
              id="dailyQuota"
              name="dailyQuota"
              type="number"
              defaultValue={dailyQuota ?? ''}
              style={{ width: 160 }}
            />
          </div>
        </div>

        <label style={{ display: 'flex', gap: 6 }}>
          <input type="checkbox" name="isActive" defaultChecked={isActive} style={{ width: 'auto' }} />
          {t('projectActiveKillSwitch')}
        </label>

        {msg?.error && <div className="error">{msg.error}</div>}
        {msg?.ok && <div className="ok">{tCommon('saved')}</div>}
        <button className="primary mt-16" type="submit">
          {t('saveConfig')}
        </button>
      </form>
    </div>
  );
}
