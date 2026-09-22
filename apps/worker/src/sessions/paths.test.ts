import { describe, expect, it } from 'vitest';
import { sessionDir } from './paths.js';

describe('sessionDir', () => {
  it('monta um diretório por accountId sob o base path', () => {
    const dir = sessionDir('/data/sessions', 'abc-123');
    expect(dir).toBe('/data/sessions/abc-123');
  });

  it('resolve caminhos relativos para absolutos', () => {
    const dir = sessionDir('./data/sessions', 'abc-123');
    expect(dir).toMatch(/\/data\/sessions\/abc-123$/);
    expect(dir.startsWith('/')).toBe(true);
  });
});
