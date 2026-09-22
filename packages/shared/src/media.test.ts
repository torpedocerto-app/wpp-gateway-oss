import { describe, expect, it } from 'vitest';
import { classifyMimeType, isAllowedMimeType, MEDIA_LIMITS } from './media.js';

describe('classifyMimeType', () => {
  it('reconhece imagens permitidas', () => {
    expect(classifyMimeType('image/jpeg')).toBe('image');
    expect(classifyMimeType('image/png')).toBe('image');
    expect(classifyMimeType('image/webp')).toBe('image');
  });

  it('reconhece PDF como documento', () => {
    expect(classifyMimeType('application/pdf')).toBe('document');
  });

  it('é case-insensitive e tolera espaços', () => {
    expect(classifyMimeType('IMAGE/JPEG')).toBe('image');
    expect(classifyMimeType('  application/pdf  ')).toBe('document');
  });

  it('rejeita tipos não suportados', () => {
    expect(classifyMimeType('image/gif')).toBeNull();
    expect(classifyMimeType('application/msword')).toBeNull();
    expect(classifyMimeType('video/mp4')).toBeNull();
    expect(classifyMimeType('')).toBeNull();
  });
});

describe('isAllowedMimeType', () => {
  it('true para permitidos, false para o resto', () => {
    expect(isAllowedMimeType('image/png')).toBe(true);
    expect(isAllowedMimeType('application/pdf')).toBe(true);
    expect(isAllowedMimeType('application/zip')).toBe(false);
  });
});

describe('MEDIA_LIMITS', () => {
  it('teto é 16MB', () => {
    expect(MEDIA_LIMITS.MAX_BYTES).toBe(16 * 1024 * 1024);
  });
});
