import { getTranslations } from 'next-intl/server';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

function Code({ children }: { children: string }) {
  return <pre className="code-block">{children}</pre>;
}

function Method({ verb }: { verb: 'POST' | 'GET' }) {
  return <span className={`method-badge method-${verb.toLowerCase()}`}>{verb}</span>;
}

export default async function ApiDocsPage() {
  const t = await getTranslations('apiDocs');
  const baseUrl = `${env.PANEL_PUBLIC_URL}/v1`;

  const sections = [
    { id: 'intro', label: t('nav.intro') },
    { id: 'auth', label: t('nav.auth') },
    { id: 'send-message', label: t('nav.sendMessage') },
    { id: 'bulk', label: t('nav.bulk') },
    { id: 'media', label: t('nav.media') },
    { id: 'get-message', label: t('nav.getMessage') },
    { id: 'list-messages', label: t('nav.listMessages') },
    { id: 'cancel', label: t('nav.cancel') },
    { id: 'health', label: t('nav.health') },
    { id: 'webhooks', label: t('nav.webhooks') },
    { id: 'phone', label: t('nav.phone') },
    { id: 'rate-limit', label: t('nav.rateLimit') },
    { id: 'errors', label: t('nav.errors') },
    { id: 'checklist', label: t('nav.checklist') },
  ];

  return (
    <div className="docs-layout">
      <nav className="docs-nav">
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.label}
          </a>
        ))}
      </nav>

      <main style={{ maxWidth: 760 }}>
        <h1 id="intro">{t('title')}</h1>
        <p className="subtitle">{t('subtitle')}</p>

        <div className="card">
          <p style={{ marginTop: 0 }}>{t('intro.p1')}</p>
          <p>{t('intro.p2')}</p>
          <table>
            <tbody>
              <tr>
                <td className="muted">{t('intro.baseUrl')}</td>
                <td>
                  <code className="inline-code">{baseUrl}</code>
                </td>
              </tr>
              <tr>
                <td className="muted">{t('intro.format')}</td>
                <td>
                  {t('intro.formatValue')} (<code className="inline-code">Content-Type: application/json</code>)
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t('principles.title')}</h3>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li>{t('principles.idempotency')}</li>
            <li>{t('principles.async')}</li>
            <li>{t('principles.predictableErrors')}</li>
            <li>{t('principles.versioned')}</li>
          </ul>
        </div>

        <h2 id="auth" style={{ marginTop: 40 }}>
          {t('auth.title')}
        </h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>{t('auth.p1')}</p>
          <Code>{`Authorization: Bearer mk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}</Code>
          <p>{t('auth.p2')}</p>
          <table>
            <thead>
              <tr>
                <th>{t('auth.colSituation')}</th>
                <th>HTTP</th>
                <th>code</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t('auth.missingHeader')}</td>
                <td>401</td>
                <td>
                  <code className="inline-code">MISSING_TOKEN</code>
                </td>
              </tr>
              <tr>
                <td>{t('auth.tokenNotFound')}</td>
                <td>401</td>
                <td>
                  <code className="inline-code">INVALID_TOKEN</code>
                </td>
              </tr>
              <tr>
                <td>{t('auth.tokenRevoked')}</td>
                <td>401</td>
                <td>
                  <code className="inline-code">TOKEN_REVOKED</code>
                </td>
              </tr>
              <tr>
                <td>{t('auth.tokenExpired')}</td>
                <td>401</td>
                <td>
                  <code className="inline-code">TOKEN_EXPIRED</code>
                </td>
              </tr>
              <tr>
                <td>{t('auth.projectInactive')}</td>
                <td>403</td>
                <td>
                  <code className="inline-code">PROJECT_INACTIVE</code>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 id="send-message" style={{ marginTop: 40 }}>
          <Method verb="POST" />
          <code className="inline-code">/v1/messages</code>
        </h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>{t('sendMessage.description')}</p>
          <p>
            <strong>{t('common.request')}</strong>
          </p>
          <Code>{`{
  "to": "5511999998888",
  "text": "Olá! Sua consulta está confirmada para amanhã às 14h.",
  "externalId": "consulta-4711-confirmacao",
  "scheduledFor": "2026-09-08T10:00:00Z",
  "preferredAccountId": null
}`}</Code>
          <table>
            <thead>
              <tr>
                <th>{t('common.field')}</th>
                <th>{t('common.required')}</th>
                <th>{t('common.rules')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code className="inline-code">to</code>
                </td>
                <td>✅</td>
                <td>{t('sendMessage.toRules')}</td>
              </tr>
              <tr>
                <td>
                  <code className="inline-code">text</code>
                </td>
                <td>✅</td>
                <td>{t('sendMessage.textRules')}</td>
              </tr>
              <tr>
                <td>
                  <code className="inline-code">externalId</code>
                </td>
                <td>❌</td>
                <td>{t('sendMessage.externalIdRules')}</td>
              </tr>
              <tr>
                <td>
                  <code className="inline-code">scheduledFor</code>
                </td>
                <td>❌</td>
                <td>{t('sendMessage.scheduledForRules')}</td>
              </tr>
              <tr>
                <td>
                  <code className="inline-code">preferredAccountId</code>
                </td>
                <td>❌</td>
                <td>{t('sendMessage.preferredAccountRules')}</td>
              </tr>
            </tbody>
          </table>
          <p>
            <strong>{t('common.response')} 202 Accepted</strong>
          </p>
          <Code>{`{
  "messageId": "01J8X4K2M9P7Q3R5T6V8W0Y2Z4",
  "status": "queued",
  "to": "5511999998888",
  "externalId": "consulta-4711-confirmacao",
  "estimatedSendAt": "2026-09-07T14:32:18Z",
  "createdAt": "2026-09-07T14:32:05Z"
}`}</Code>
          <p className="muted" style={{ fontSize: 13 }}>
            {t('sendMessage.idempotencyNote')}
          </p>
          <p>
            <strong>{t('common.specificErrors')}</strong>
          </p>
          <table>
            <thead>
              <tr>
                <th>HTTP</th>
                <th>code</th>
                <th>{t('common.when')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>422</td>
                <td>
                  <code className="inline-code">INVALID_PHONE_NUMBER</code>
                </td>
                <td>{t('sendMessage.errInvalidPhone')}</td>
              </tr>
              <tr>
                <td>422</td>
                <td>
                  <code className="inline-code">TEXT_TOO_LONG</code>
                </td>
                <td>{t('sendMessage.errTextTooLong')}</td>
              </tr>
              <tr>
                <td>422</td>
                <td>
                  <code className="inline-code">INVALID_SCHEDULE</code>
                </td>
                <td>{t('sendMessage.errInvalidSchedule')}</td>
              </tr>
              <tr>
                <td>422</td>
                <td>
                  <code className="inline-code">RECIPIENT_OPTED_OUT</code>
                </td>
                <td>{t('sendMessage.errOptedOut')}</td>
              </tr>
              <tr>
                <td>429</td>
                <td>
                  <code className="inline-code">RATE_LIMIT_EXCEEDED</code>
                </td>
                <td>{t('sendMessage.errRateLimit')}</td>
              </tr>
              <tr>
                <td>429</td>
                <td>
                  <code className="inline-code">DAILY_QUOTA_EXCEEDED</code>
                </td>
                <td>{t('sendMessage.errDailyQuota')}</td>
              </tr>
              <tr>
                <td>503</td>
                <td>
                  <code className="inline-code">NO_ACCOUNTS_AVAILABLE</code>
                </td>
                <td>{t('sendMessage.errNoAccounts')}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 13 }}>
            {t('sendMessage.noAccountsNote')}
          </p>
        </div>

        <h2 id="bulk" style={{ marginTop: 40 }}>
          <Method verb="POST" />
          <code className="inline-code">/v1/messages/bulk</code>
        </h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>{t('bulk.description')}</p>
          <Code>{`{
  "messages": [
    { "to": "5511999998888", "text": "Olá João!", "externalId": "lote-1-joao" },
    { "to": "5511988887777", "text": "Olá Maria!", "externalId": "lote-1-maria" }
  ]
}`}</Code>
          <p>
            <strong>{t('common.response')} 202 Accepted</strong> — {t('bulk.partialValidation')}
          </p>
          <Code>{`{
  "accepted": 1,
  "rejected": 1,
  "messages": [
    { "index": 0, "messageId": "01J8X...", "status": "queued" }
  ],
  "errors": [
    { "index": 1, "code": "INVALID_PHONE_NUMBER", "message": "Número inválido" }
  ]
}`}</Code>
        </div>

        <h2 id="media" style={{ marginTop: 40 }}>
          <Method verb="POST" />
          <code className="inline-code">/v1/messages/media</code>
        </h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>{t('media.description')}</p>
          <table>
            <thead>
              <tr>
                <th>{t('common.field')}</th>
                <th>{t('common.required')}</th>
                <th>{t('common.rules')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code className="inline-code">to</code>
                </td>
                <td>✅</td>
                <td>{t('media.toRules')}</td>
              </tr>
              <tr>
                <td>
                  <code className="inline-code">file</code>
                </td>
                <td>✅</td>
                <td>{t('media.fileRules')}</td>
              </tr>
              <tr>
                <td>
                  <code className="inline-code">caption</code>
                </td>
                <td>❌</td>
                <td>{t('media.captionRules')}</td>
              </tr>
              <tr>
                <td>
                  <code className="inline-code">externalId</code>
                </td>
                <td>❌</td>
                <td>{t('media.externalIdRules')}</td>
              </tr>
            </tbody>
          </table>
          <p>
            <strong>{t('common.response')} 202 Accepted</strong>
          </p>
          <Code>{`{
  "messageId": "01J8X...",
  "status": "queued",
  "to": "+5511999998888",
  "externalId": "relatorio-sexta-w37",
  "createdAt": "2026-09-11T14:00:00Z"
}`}</Code>
          <p className="muted" style={{ fontSize: 13 }}>
            {t('media.storageNote')}
          </p>
        </div>

        <h2 id="get-message" style={{ marginTop: 40 }}>
          <Method verb="GET" />
          <code className="inline-code">/v1/messages/{'{messageId}'}</code>
        </h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>{t('getMessage.description')}</p>
          <Code>{`{
  "messageId": "01J8X4K2M9P7Q3R5T6V8W0Y2Z4",
  "status": "delivered",
  "to": "5511999998888",
  "text": "Olá! Sua consulta...",
  "externalId": "consulta-4711-confirmacao",
  "attemptCount": 1,
  "timeline": {
    "createdAt":   "2026-09-07T14:32:05Z",
    "queuedAt":    "2026-09-07T14:32:05Z",
    "sentAt":      "2026-09-07T14:32:19Z",
    "deliveredAt": "2026-09-07T14:32:24Z",
    "readAt":      null
  },
  "error": null
}`}</Code>
          <p>{t('getMessage.onFailure')}</p>
          <Code>{`{
  "status": "failed",
  "error": {
    "code": "NUMBER_NOT_ON_WHATSAPP",
    "message": "O número de destino não possui WhatsApp",
    "retryable": false
  }
}`}</Code>
          <p className="muted" style={{ fontSize: 13 }}>
            {t('getMessage.scopeNote')}
          </p>
        </div>

        <h2 id="list-messages" style={{ marginTop: 40 }}>
          <Method verb="GET" />
          <code className="inline-code">/v1/messages</code>
        </h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>{t('listMessages.description')}</p>
          <Code>{`{
  "data": [ /* … */ ],
  "pagination": { "nextCursor": "eyJpZCI6IjAxSjhY…", "hasMore": true }
}`}</Code>
        </div>

        <h2 id="cancel" style={{ marginTop: 40 }}>
          <Method verb="POST" />
          <code className="inline-code">/v1/messages/{'{messageId}'}/cancel</code>
        </h2>
        <div className="card">
          <p style={{ marginTop: 0, marginBottom: 0 }}>{t('cancel.description')}</p>
        </div>

        <h2 id="health" style={{ marginTop: 40 }}>
          <Method verb="GET" />
          <code className="inline-code">/v1/health</code>
        </h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>{t('health.description')}</p>
          <Code>{`{
  "status": "healthy",
  "accountsTotal": 5,
  "accountsAvailable": 4,
  "queueDepth": 12,
  "estimatedDelaySeconds": 45
}`}</Code>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            {t('health.statusNote')}
          </p>
        </div>

        <h2 id="webhooks" style={{ marginTop: 40 }}>
          {t('webhooks.title')}
        </h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>{t('webhooks.p1')}</p>
          <h4>{t('webhooks.signatureTitle')}</h4>
          <Code>{`POST /seu-endpoint HTTP/1.1
X-Wpp-Signature: sha256=5d41402abc4b2a76b9719d911017c592
X-Wpp-Timestamp: 1757251925
X-Wpp-Event: message.received
X-Wpp-Delivery: 01J8X4K2M9P7Q3R5T6V8W0Y2Z4`}</Code>
          <p>
            {t('webhooks.hmacFormula')}{' '}
            <code className="inline-code">HMAC-SHA256(webhook_secret, &quot;{'{timestamp}.{body_raw}'}&quot;)</code>
          </p>
          <p style={{ marginBottom: 4 }}>
            <strong>{t('webhooks.validationTitle')}</strong>
          </p>
          <ol style={{ paddingLeft: 20, margin: 0 }}>
            <li>{t('webhooks.validation1')}</li>
            <li>{t('webhooks.validation2')}</li>
            <li>{t('webhooks.validation3')}</li>
          </ol>

          <h4>{t('webhooks.statusEventTitle')}</h4>
          <Code>{`{
  "event": "message.status",
  "timestamp": "2026-09-07T14:32:24Z",
  "data": {
    "messageId": "01J8X4K2M9P7Q3R5T6V8W0Y2Z4",
    "externalId": "consulta-4711-confirmacao",
    "status": "delivered",
    "to": "5511999998888",
    "error": null
  }
}`}</Code>
          <p className="muted" style={{ fontSize: 13 }}>
            {t('webhooks.statusEventNote')}
          </p>

          <h4>{t('webhooks.receivedEventTitle')}</h4>
          <Code>{`{
  "event": "message.received",
  "timestamp": "2026-09-07T14:40:11Z",
  "data": {
    "messageId": "01J8X5N3P0Q8R4S6U7W9Y1Z3A5",
    "from": "5511999998888",
    "text": "Confirmado, obrigado!",
    "receivedAt": "2026-09-07T14:40:10Z",
    "inReplyTo": {
      "messageId": "01J8X4K2M9P7Q3R5T6V8W0Y2Z4",
      "externalId": "consulta-4711-confirmacao"
    }
  }
}`}</Code>

          <h4>{t('webhooks.retryTitle')}</h4>
          <table>
            <thead>
              <tr>
                <th>{t('webhooks.colAttempt')}</th>
                <th>{t('webhooks.colDelay')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td>{t('webhooks.immediate')}</td>
              </tr>
              <tr>
                <td>2</td>
                <td>30 s</td>
              </tr>
              <tr>
                <td>3</td>
                <td>2 min</td>
              </tr>
              <tr>
                <td>4</td>
                <td>10 min</td>
              </tr>
              <tr>
                <td>5</td>
                <td>1 h</td>
              </tr>
              <tr>
                <td>6</td>
                <td>6 h</td>
              </tr>
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            {t('webhooks.retryNote')}
          </p>
        </div>

        <h2 id="phone" style={{ marginTop: 40 }}>
          {t('phone.title')}
        </h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>{t('phone.p1')}</p>
          <table>
            <thead>
              <tr>
                <th>{t('phone.colInput')}</th>
                <th>{t('phone.colNormalized')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code className="inline-code">11999998888</code>
                </td>
                <td>
                  <code className="inline-code">+5511999998888</code> ({t('phone.assumesBr')})
                </td>
              </tr>
              <tr>
                <td>
                  <code className="inline-code">(11) 99999-8888</code>
                </td>
                <td>
                  <code className="inline-code">+5511999998888</code>
                </td>
              </tr>
              <tr>
                <td>
                  <code className="inline-code">5511999998888</code>
                </td>
                <td>
                  <code className="inline-code">+5511999998888</code>
                </td>
              </tr>
              <tr>
                <td>
                  <code className="inline-code">+55 11 99999-8888</code>
                </td>
                <td>
                  <code className="inline-code">+5511999998888</code>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
            {t('phone.cacheNote')}
          </p>
        </div>

        <h2 id="rate-limit" style={{ marginTop: 40 }}>
          {t('rateLimit.title')}
        </h2>
        <div className="card">
          <p style={{ marginTop: 0 }}>{t('rateLimit.p1')}</p>
          <table>
            <thead>
              <tr>
                <th>{t('rateLimit.colLevel')}</th>
                <th>{t('rateLimit.colLimit')}</th>
                <th>{t('rateLimit.colScope')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t('rateLimit.httpRequests')}</td>
                <td>
                  <code className="inline-code">rate_limit_per_minute</code> ({t('rateLimit.defaultValue', { n: 60 })})
                </td>
                <td>{t('rateLimit.perToken')}</td>
              </tr>
              <tr>
                <td>{t('rateLimit.messagesPerDay')}</td>
                <td>
                  <code className="inline-code">daily_quota</code>
                </td>
                <td>{t('rateLimit.perProject')}</td>
              </tr>
            </tbody>
          </table>
          <Code>{`X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 1757251980`}</Code>
        </div>

        <h2 id="errors" style={{ marginTop: 40 }}>
          {t('errors.title')}
        </h2>
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>code</th>
                <th>HTTP</th>
                <th>Retryable</th>
                <th>{t('errors.colMeaning')}</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['MISSING_TOKEN', 401, false, t('errors.missingToken')],
                ['INVALID_TOKEN', 401, false, t('errors.invalidToken')],
                ['TOKEN_REVOKED', 401, false, t('errors.tokenRevoked')],
                ['TOKEN_EXPIRED', 401, false, t('errors.tokenExpired')],
                ['PROJECT_INACTIVE', 403, false, t('errors.projectInactive')],
                ['MESSAGE_NOT_FOUND', 404, false, t('errors.messageNotFound')],
                ['MESSAGE_NOT_CANCELABLE', 409, false, t('errors.messageNotCancelable')],
                ['INVALID_PHONE_NUMBER', 422, false, t('errors.invalidPhoneNumber')],
                ['TEXT_TOO_LONG', 422, false, t('errors.textTooLong')],
                ['INVALID_SCHEDULE', 422, false, t('errors.invalidSchedule')],
                ['RECIPIENT_OPTED_OUT', 422, false, t('errors.recipientOptedOut')],
                ['MISSING_MEDIA_FILE', 422, false, t('errors.missingMediaFile')],
                ['UNSUPPORTED_MEDIA_TYPE', 415, false, t('errors.unsupportedMediaType')],
                ['MEDIA_TOO_LARGE', 413, false, t('errors.mediaTooLarge')],
                ['RATE_LIMIT_EXCEEDED', 429, true, t('errors.rateLimitExceeded')],
                ['DAILY_QUOTA_EXCEEDED', 429, true, t('errors.dailyQuotaExceeded')],
                ['NO_ACCOUNTS_AVAILABLE', 503, true, t('errors.noAccountsAvailable')],
                ['INTERNAL_ERROR', 500, true, t('errors.internalError')],
              ].map(([code, http, retryable, meaning]) => (
                <tr key={code as string}>
                  <td>
                    <code className="inline-code">{code}</code>
                  </td>
                  <td>{http}</td>
                  <td>{retryable ? '✅' : '❌'}</td>
                  <td>{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginBottom: 8 }}>
            <strong>{t('errors.defaultFormat')}</strong>
          </p>
          <Code>{`{
  "error": {
    "code": "INVALID_PHONE_NUMBER",
    "message": "O número informado não é válido",
    "details": { "field": "to", "value": "119999" }
  }
}`}</Code>
        </div>

        <h2 id="checklist" style={{ marginTop: 40 }}>
          {t('checklist.title')}
        </h2>
        <div className="card" style={{ marginBottom: 40 }}>
          <p style={{ marginTop: 0 }}>{t('checklist.p1')}</p>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li>{t('checklist.item1')}</li>
            <li>{t('checklist.item2')}</li>
            <li>{t('checklist.item3')}</li>
            <li>{t('checklist.item4')}</li>
            <li>{t('checklist.item5')}</li>
            <li>{t('checklist.item6')}</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
