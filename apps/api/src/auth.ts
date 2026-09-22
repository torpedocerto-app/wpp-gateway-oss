import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { prisma } from '@wpp/database';
import { ApiError } from '@wpp/shared';

/**
 * Autenticação por token da API pública (doc 03 §2).
 *
 * Fluxo:
 *  1. extrai `Authorization: Bearer mk_live_...`
 *  2. SHA-256 do token
 *  3. consulta cache Redis `authtoken:{hash}` (TTL 60s)
 *  4. miss → SELECT em api_tokens + join projects, valida revogação/expiração/ativação
 *  5. anexa { projectId, apiTokenId, project } ao request
 *
 * O token em claro NUNCA é logado nem persistido — só o hash.
 */

const CACHE_TTL_S = 60;

export interface AuthContext {
  apiTokenId: string;
  projectId: string;
  projectSlug: string;
  rateLimitPerMinute: number;
  dailyQuota: number | null;
}

/** Cacheável: o que precisamos do token+projeto, sem PII. */
interface CachedAuth extends AuthContext {
  /** epoch ms — para não confiar em cache além da expiração real do token. */
  tokenExpiresAt: number | null;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function extractBearer(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new ApiError('MISSING_TOKEN');
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) throw new ApiError('MISSING_TOKEN');
  return token;
}

export function makeAuthPreHandler(redis: Redis) {
  return async function authPreHandler(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const token = extractBearer(req);
    const hash = hashToken(token);
    const cacheKey = `authtoken:${hash}`;

    // 1. cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      const auth = JSON.parse(cached) as CachedAuth;
      if (auth.tokenExpiresAt !== null && Date.now() > auth.tokenExpiresAt) {
        throw new ApiError('TOKEN_EXPIRED');
      }
      req.auth = stripCacheMeta(auth);
      return;
    }

    // 2. banco
    const row = await prisma.apiToken.findUnique({
      where: { tokenHash: hash },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        project: {
          select: {
            id: true,
            slug: true,
            isActive: true,
            rateLimitPerMinute: true,
            dailyQuota: true,
          },
        },
      },
    });

    if (!row) throw new ApiError('INVALID_TOKEN');
    if (row.revokedAt) throw new ApiError('TOKEN_REVOKED');
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) throw new ApiError('TOKEN_EXPIRED');
    if (!row.project.isActive) throw new ApiError('PROJECT_INACTIVE');

    const auth: CachedAuth = {
      apiTokenId: row.id,
      projectId: row.project.id,
      projectSlug: row.project.slug,
      rateLimitPerMinute: row.project.rateLimitPerMinute,
      dailyQuota: row.project.dailyQuota,
      tokenExpiresAt: row.expiresAt?.getTime() ?? null,
    };

    await redis.set(cacheKey, JSON.stringify(auth), 'EX', CACHE_TTL_S);
    req.auth = stripCacheMeta(auth);

    // last_used_at: atualização best-effort, não bloqueia a request
    void prisma.apiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  };
}

function stripCacheMeta(a: CachedAuth): AuthContext {
  return {
    apiTokenId: a.apiTokenId,
    projectId: a.projectId,
    projectSlug: a.projectSlug,
    rateLimitPerMinute: a.rateLimitPerMinute,
    dailyQuota: a.dailyQuota,
  };
}

/**
 * Invalida o cache de um token (chamado quando o painel revoga — Fase 6).
 * Recebe o token em claro OU o hash já calculado.
 */
export async function invalidateTokenCache(redis: Redis, tokenOrHash: string): Promise<void> {
  const hash = tokenOrHash.startsWith('mk_') ? hashToken(tokenOrHash) : tokenOrHash;
  await redis.del(`authtoken:${hash}`);
}

// tipa req.auth
declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
}
