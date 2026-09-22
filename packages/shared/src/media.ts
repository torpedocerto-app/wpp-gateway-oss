/**
 * Envio de mídia (imagem/PDF) — validação pura, sem I/O (doc 03 §3.3).
 *
 * O WhatsApp tem limites próprios de tamanho de mídia; aqui adotamos um teto
 * único e conservador (16MB) para imagem e documento, ajustável depois.
 */

export const MEDIA_LIMITS = {
  MAX_BYTES: 16 * 1024 * 1024, // 16MB
} as const;

export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf'] as const;

export type MediaKind = 'image' | 'document';

/** Classifica um mimetype em `image` | `document`, ou `null` se não suportado. */
export function classifyMimeType(mimetype: string): MediaKind | null {
  const normalized = mimetype.trim().toLowerCase();
  if ((ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(normalized)) return 'image';
  if ((ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(normalized)) return 'document';
  return null;
}

/** `true` se o mimetype está na allowlist (imagem ou documento). */
export function isAllowedMimeType(mimetype: string): boolean {
  return classifyMimeType(mimetype) !== null;
}
