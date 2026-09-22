'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { sendChatMessageAction, typingAction } from '@/app/actions/chat';

interface Msg {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  status: string;
  createdAt: string;
  errorCode: string | null;
}

export function ChatThread({
  contact,
  accountId,
  accountReady,
  initialMessages,
}: {
  contact: string;
  accountId: string;
  accountReady: boolean;
  initialMessages: Msg[];
}) {
  const t = useTranslations('chat');
  const tActions = useTranslations('actions.chat');
  const format = useFormatter();
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const pausedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** epoch ms do último 'composing' enviado — throttle de 1 a cada 4s. */
  const lastComposingAt = useRef(0);

  // scroll para o fim quando a lista muda
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // SSE de mensagens novas (inbound) — filtra por este contato + conta
  const [streamDown, setStreamDown] = useState(false);
  useEffect(() => {
    const es = new EventSource('/chat/stream');
    es.addEventListener('inbound', (e) => {
      const data = JSON.parse((e as MessageEvent).data) as {
        accountId: string;
        from: string;
        text: string;
        at: string;
      };
      if (data.accountId !== accountId) return;
      if (data.from.replace(/\D/g, '') !== contact.replace(/\D/g, '')) return;
      setMessages((prev) => [
        ...prev,
        {
          id: `sse-${Date.now()}`,
          direction: 'INBOUND',
          content: data.text,
          status: 'DELIVERED',
          createdAt: data.at,
          errorCode: null,
        },
      ]);
    });
    es.addEventListener('unavailable', () => {
      setStreamDown(true);
      es.close();
    });
    es.onerror = () => {
      // conexão caiu; o browser tenta reconectar sozinho, mas sinaliza
      setStreamDown(true);
    };
    return () => es.close();
  }, [accountId, contact]);

  function onType(v: string) {
    setText(v);

    // "digitando": no máximo 1 a cada 4s (não a cada tecla).
    const now = Date.now();
    if (now - lastComposingAt.current > 4000) {
      lastComposingAt.current = now;
      void typingAction(accountId, contact, 'composing');
    }

    // "parou de digitar": 3s após a última tecla.
    if (pausedTimer.current) clearTimeout(pausedTimer.current);
    pausedTimer.current = setTimeout(() => {
      lastComposingAt.current = 0; // permite reenviar 'composing' na próxima digitação
      void typingAction(accountId, contact, 'paused');
    }, 3000);
  }

  function send() {
    const clean = text.trim();
    if (!clean) return;
    setError(null);

    // cancela o 'paused' pendente — o envio já encerra a digitação
    if (pausedTimer.current) clearTimeout(pausedTimer.current);
    lastComposingAt.current = 0;

    // otimista
    const tempId = `tmp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        direction: 'OUTBOUND',
        content: clean,
        status: 'SENDING',
        createdAt: new Date().toISOString(),
        errorCode: null,
      },
    ]);
    setText('');

    start(async () => {
      const r = await sendChatMessageAction(accountId, contact, clean);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId
            ? {
                ...m,
                status: r.ok
                  ? r.ack === 'read'
                    ? 'READ'
                    : r.ack === 'delivery_ack'
                      ? 'DELIVERED'
                      : 'SENT'
                  : 'FAILED',
                errorCode: r.ok ? null : (r.error ?? tActions('genericFailure')),
              }
            : m,
        ),
      );
      if (!r.ok) setError(r.error ?? tActions('genericFailure'));
    });
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '60vh' }}>
      {streamDown && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
          {t('streamDownWarning')}
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', padding: 4 }}>
        {messages.length === 0 && (
          <p className="muted" style={{ textAlign: 'center' }}>
            {t('noMessagesYet')}
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              display: 'flex',
              justifyContent: m.direction === 'OUTBOUND' ? 'flex-end' : 'flex-start',
              margin: '6px 0',
            }}
          >
            <div
              style={{
                maxWidth: '70%',
                padding: '8px 12px',
                borderRadius: 10,
                background:
                  m.direction === 'OUTBOUND' ? 'var(--accent)' : 'var(--surface-2)',
                color: m.direction === 'OUTBOUND' ? '#fff' : 'var(--text)',
                opacity: m.status === 'SENDING' ? 0.6 : 1,
              }}
            >
              <div>{m.content}</div>
              <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>
                {format.dateTime(new Date(m.createdAt), 'time')}
                {m.direction === 'OUTBOUND' && ` · ${m.status.toLowerCase()}`}
                {m.errorCode && <span style={{ color: '#fecaca' }}> · {m.errorCode}</span>}
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {error && <div className="error">{error}</div>}

      <div className="row" style={{ marginTop: 8 }}>
        <input
          placeholder={accountReady ? t('typeMessage') : t('accountUnavailablePlaceholder')}
          value={text}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={!accountReady || pending}
        />
        <button className="primary" onClick={send} disabled={!accountReady || pending || !text.trim()}>
          {pending ? t('sending') : t('send')}
        </button>
      </div>
    </div>
  );
}
