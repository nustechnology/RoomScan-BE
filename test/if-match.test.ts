import { describe, expect, it } from 'vitest';

import { AppError } from '../src/common/errors/app-error.js';
import { parseIfMatch } from '../src/common/http/if-match.js';

describe('parseIfMatch', () => {
  it('returns undefined when no header is present', () => {
    expect(parseIfMatch(undefined)).toBeUndefined();
  });

  it('parses a plain integer revision', () => {
    expect(parseIfMatch('3')).toBe(3);
  });

  it('parses a quoted revision', () => {
    expect(parseIfMatch('"3"')).toBe(3);
  });

  it('trims surrounding whitespace', () => {
    expect(parseIfMatch('  7  ')).toBe(7);
  });

  it.each(['', 'abc', '1.5', '0', '-1', '1 2'])('rejects an invalid value: %s', (value) => {
    expect(() => parseIfMatch(value)).toThrow(AppError);
  });

  it('rejects a revision above the safe integer range', () => {
    expect(() => parseIfMatch('9007199254740992')).toThrow(AppError);
  });
});
