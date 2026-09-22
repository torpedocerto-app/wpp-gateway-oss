'use client';

import { useState, useTransition } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { createTokenAction, revokeTokenAction } from '@/app/actions/projects';

interface Token {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function TokenManager({ projectId, tokens }: { projectId: string; tokens: Token[] }) {
  const t = useTranslations('projects');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const [pending, start] = useTransition();
  const [newPlain, setNewPlain] = useState<string | null>(null);
  const [name, setName] = useState('');

  async function create(fd: FormData) {
    const r = await createTokenAction(projectId, fd);
    if (r.plainToken) setNewPlain(r.plainToken);
    setName('');
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>{t('accessTokens')}</h3>

      {newPlain && (
        <div className="card" style={{ background: 'var(--surface-2)', marginBottom: 12 }}>
          <p className="ok">{t('tokenCreatedCopyNow')}</p>
          <code style={{ wordBreak: 'break-all', display: 'block', padding: 8 }}>{newPlain}</code>
          <button className="mt-16" onClick={() => setNewPlain(null)}>
            {t('gotItSaved')}
          </button>
        </div>
      )}

      {tokens.length === 0 ? (
        <p className="muted">{t('noTokens')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('tokenName')}</th>
              <th>{t('colPrefix')}</th>
              <th>{t('lastUsed')}</th>
              <th>{t('colStatus')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((tok) => (
              <tr key={tok.id}>
                <td>{tok.name}</td>
                <td className="muted">{tok.prefix}…</td>
                <td className="muted">
                  {tok.lastUsedAt ? format.dateTime(new Date(tok.lastUsedAt), 'short') : tCommon('never')}
                </td>
                <td>{tok.revokedAt ? t('revoked') : t('active')}</td>
                <td>
                  {!tok.revokedAt && (
                    <button
                      className="danger"
                      disabled={pending}
                      onClick={() => start(() => revokeTokenAction(tok.id, projectId))}
                    >
                      {t('revoke')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form action={create} className="row mt-16" style={{ alignItems: 'flex-end' }}>
        <div>
          <label htmlFor="tokenName">{t('newToken')}</label>
          <input
            id="tokenName"
            name="tokenName"
            placeholder={t('tokenName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: 200 }}
          />
        </div>
        <button className="primary" type="submit" disabled={pending}>
          {t('generate')}
        </button>
      </form>
    </div>
  );
}
