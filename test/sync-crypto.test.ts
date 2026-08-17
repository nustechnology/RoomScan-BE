import { describe, expect, it } from 'vitest';

import { canonicalJson, SyncCrypto } from '../src/infrastructure/crypto/sync-crypto.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('SyncCrypto', () => {
  it('canonicalizes object keys, dates, arrays, and undefined values deterministically', () => {
    expect(
      canonicalJson({ z: undefined, b: [2, { y: 1, x: 0 }], a: new Date('2026-08-17T00:00:00Z') }),
    ).toBe('{"a":"2026-08-17T00:00:00.000Z","b":[2,{"x":0,"y":1}]}');
  });

  it('hashes canonical payloads and raw key strings separately', () => {
    const crypto = new SyncCrypto(KEY);

    expect(crypto.hash({ b: 2, a: 1 })).toBe(crypto.hash({ a: 1, b: 2 }));
    expect(crypto.hashString('retry-key')).toMatch(/^[a-f0-9]{64}$/);
    expect(crypto.hashString('retry-key')).not.toBe(crypto.hash('retry-key'));
  });

  it('encrypts and authenticates receipt JSON', () => {
    const crypto = new SyncCrypto(KEY);
    const encrypted = crypto.encryptJson({ status: 201, body: { id: 'resource-id' } });

    expect(crypto.decryptJson(encrypted)).toEqual({ body: { id: 'resource-id' }, status: 201 });

    const tampered = Uint8Array.from(encrypted);
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;
    expect(() => crypto.decryptJson(tampered)).toThrow();
    expect(() => crypto.decryptJson(Uint8Array.from([2]))).toThrow('Unsupported encrypted receipt');
  });

  it('signs cursor payloads and rejects malformed or tampered tokens', () => {
    const crypto = new SyncCrypto(KEY);
    const token = crypto.signCursor({ v: 1, after: '10' });

    expect(crypto.verifyCursor(token)).toEqual({ after: '10', v: 1 });
    expect(() => crypto.verifyCursor('not-a-cursor')).toThrow('Malformed cursor');
    expect(() => crypto.verifyCursor(`${token.slice(0, -1)}x`)).toThrow('Invalid cursor signature');
  });

  it('requires a base64 key that decodes to exactly 32 bytes', () => {
    expect(() => new SyncCrypto(Buffer.alloc(31).toString('base64'))).toThrow(
      'SYNC_CRYPTO_KEY must decode to exactly 32 bytes',
    );
  });
});
