'use server';

import { createHash, randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@wpp/database';
import { checkWebhookUrl } from '@wpp/shared';
import { dispatchWebhook } from '@wpp/queue';
import { requireSession } from '@/lib/auth';
import { ssrfReasonLabel } from '@/i18n/labels';

function genToken(): { plain: string; hash: string; prefix: string } {
  const raw = randomBytes(24).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  const plain = `mk_live_${raw}`;
  return { plain, hash: createHash('sha256').update(plain).digest('hex'), prefix: plain.slice(0, 12) };
}

export async function createProjectAction(
  formData: FormData,
): Promise<{ error?: string; slug?: string }> {
  await requireSession();
  const t = await getTranslations('actions.projects');
  const name = String(formData.get('name') ?? '').trim();
  const slug = String(formData.get('slug') ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-');
  if (!name || !slug) return { error: t('nameSlugRequired') };
  const exists = await prisma.project.findUnique({ where: { slug } });
  if (exists) return { error: t('slugExists') };
  await prisma.project.create({ data: { name, slug, webhookEvents: [] } });
  revalidatePath('/projects');
  return { slug };
}

export async function updateProjectAction(
  id: string,
  formData: FormData,
): Promise<{ error?: string; ok?: boolean }> {
  await requireSession();
  const t = await getTranslations('actions.projects');
  const webhookUrl = String(formData.get('webhookUrl') ?? '').trim() || null;
  const webhookSecret = String(formData.get('webhookSecret') ?? '').trim() || undefined;
  const events = formData.getAll('events').map(String);
  const rateLimitPerMinute = Number(formData.get('rateLimitPerMinute') ?? 60);
  const dailyQuotaRaw = String(formData.get('dailyQuota') ?? '').trim();
  const dailyQuota = dailyQuotaRaw ? Number(dailyQuotaRaw) : null;
  const isActive = formData.get('isActive') === 'on';

  if (webhookUrl) {
    const c = checkWebhookUrl(webhookUrl);
    if (!c.ok) {
      const tSsrf = await getTranslations('ssrfReason');
      return { error: t('webhookUrlInvalid', { reason: ssrfReasonLabel(tSsrf, c.reason) }) };
    }
  }

  await prisma.project.update({
    where: { id },
    data: {
      webhookUrl,
      ...(webhookSecret ? { webhookSecret } : {}),
      webhookEvents: events,
      rateLimitPerMinute: Number.isFinite(rateLimitPerMinute) ? rateLimitPerMinute : 60,
      dailyQuota: dailyQuota && Number.isFinite(dailyQuota) ? dailyQuota : null,
      isActive,
    },
  });
  revalidatePath(`/projects/${id}`);
  return { ok: true };
}

export async function createTokenAction(
  projectId: string,
  formData: FormData,
): Promise<{ error?: string; plainToken?: string }> {
  await requireSession();
  const name = String(formData.get('tokenName') ?? '').trim() || 'Token';
  const t = genToken();
  await prisma.apiToken.create({
    data: { projectId, name, tokenHash: t.hash, tokenPrefix: t.prefix },
  });
  revalidatePath(`/projects/${projectId}`);
  return { plainToken: t.plain };
}

export async function revokeTokenAction(tokenId: string, projectId: string): Promise<void> {
  await requireSession();
  await prisma.apiToken.update({ where: { id: tokenId }, data: { revokedAt: new Date() } });
  revalidatePath(`/projects/${projectId}`);
}

/** Dispara um webhook de teste (doc 07 §5.1 "botão Testar"). */
export async function testWebhookAction(
  projectId: string,
): Promise<{ ok: boolean; message: string }> {
  await requireSession();
  const t = await getTranslations('actions.projects');
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { webhookUrl: true, webhookSecret: true },
  });
  if (!project?.webhookUrl) return { ok: false, message: t('setWebhookUrlFirst') };
  if (!project.webhookSecret) return { ok: false, message: t('setWebhookSecretFirst') };
  const c = checkWebhookUrl(project.webhookUrl);
  if (!c.ok) {
    const tSsrf = await getTranslations('ssrfReason');
    return { ok: false, message: t('webhookUrlInvalid', { reason: ssrfReasonLabel(tSsrf, c.reason) }) };
  }

  const r = await dispatchWebhook({
    projectId,
    event: 'webhook.test',
    bypassEventFilter: true,
    data: { test: true, note: 'Webhook de teste do painel', timestamp: new Date().toISOString() },
  });
  revalidatePath(`/projects/${projectId}`);
  return r.dispatched
    ? { ok: true, message: t('testWebhookQueued') }
    : { ok: false, message: t('notQueued', { reason: r.reason ?? t('unknownReason') }) };
}
