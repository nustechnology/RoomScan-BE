import { describe, expect, it } from 'vitest';

import {
  PUBLIC_USER_ID_ALPHABET,
  PUBLIC_USER_ID_LENGTH,
  generatePublicUserId,
  normalizePublicUserId,
} from '../src/common/identifiers/public-user-id.js';

describe('generatePublicUserId', () => {
  it('produces ids of the fixed length drawn from the unambiguous alphabet', () => {
    for (let index = 0; index < 200; index += 1) {
      const id = generatePublicUserId();

      expect(id).toHaveLength(PUBLIC_USER_ID_LENGTH);
      for (const character of id) {
        expect(PUBLIC_USER_ID_ALPHABET).toContain(character);
      }
    }
  });

  it('omits the characters people confuse when reading an id aloud', () => {
    for (const character of ['0', '1', 'I', 'L', 'O', 'U']) {
      expect(PUBLIC_USER_ID_ALPHABET).not.toContain(character);
    }
  });

  it('does not repeat itself across a large sample', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generatePublicUserId()));

    expect(ids.size).toBe(1000);
  });
});

describe('normalizePublicUserId', () => {
  it('uppercases and trims a well-formed id', () => {
    expect(normalizePublicUserId('  gp5hs2wkbe  ')).toBe('GP5HS2WKBE');
  });

  it('keeps an already canonical id unchanged', () => {
    expect(normalizePublicUserId('GP5HS2WKBE')).toBe('GP5HS2WKBE');
  });

  it.each([
    ['too short', 'GP5HS2WKB'],
    ['too long', 'GP5HS2WKBEX'],
    ['an excluded character', 'GP5HS2WKB0'],
    ['a separator', 'GP5HS-WKBE'],
    ['an empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(normalizePublicUserId(value)).toBeNull();
  });
});
