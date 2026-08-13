import { describe, expect, it } from 'vitest';

import { InvalidCursorError } from '../src/modules/sync/sync.errors.js';
import { decodeSyncCursor, encodeSyncCursor } from '../src/modules/sync/sync-cursor.js';

const NOW = new Date('2026-07-29T10:00:00.000Z');
const ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';

describe('sync cursor', () => {
  it('round-trips an encoded cursor', () => {
    const encoded = encodeSyncCursor(NOW, ID);
    const decoded = decodeSyncCursor(encoded);

    expect(decoded).toEqual({ updatedAt: NOW.getTime(), id: ID });
  });

  it('returns null for an absent cursor', () => {
    expect(decodeSyncCursor(undefined)).toBeNull();
  });

  it.each([
    ['not base64url', '@@@'],
    ['invalid JSON', Buffer.from('not json', 'utf8').toString('base64url')],
    ['missing fields', Buffer.from('{}', 'utf8').toString('base64url')],
    [
      'non-numeric v',
      Buffer.from(JSON.stringify({ v: 'x', id: ID }), 'utf8').toString('base64url'),
    ],
    [
      'invalid id shape',
      Buffer.from(JSON.stringify({ v: 1, id: 'not-a-uuid' }), 'utf8').toString('base64url'),
    ],
  ])('rejects a malformed cursor (%s)', (_label, cursor) => {
    expect(() => decodeSyncCursor(cursor)).toThrow(InvalidCursorError);
  });
});
