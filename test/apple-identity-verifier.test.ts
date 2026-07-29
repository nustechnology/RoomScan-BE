import {
  customFetch,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type FetchImplementation,
  type JWTVerifyGetKey,
  type JWTPayload,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  AppleIdentityTokenVerifier,
  createAppleRemoteKeyResolver,
} from '../src/infrastructure/auth/apple-identity-verifier.js';
import {
  AppleIdentityProviderUnavailableError,
  InvalidAppleIdentityTokenError,
} from '../src/modules/auth/auth.errors.js';

const NOW = new Date('2026-07-23T07:00:00.000Z');
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const CLIENT_ID = 'com.example.roomscan';
const KEY_ID = 'apple-key';

type GeneratedKeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

let privateKey: GeneratedKeyPair['privateKey'];
let otherPrivateKey: GeneratedKeyPair['privateKey'];
let keyResolver: JWTVerifyGetKey;

beforeAll(async () => {
  const primaryKeyPair = await generateKeyPair('RS256');
  const otherKeyPair = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(primaryKeyPair.publicKey);

  privateKey = primaryKeyPair.privateKey;
  otherPrivateKey = otherKeyPair.privateKey;
  keyResolver = createLocalJWKSet({
    keys: [
      {
        ...publicJwk,
        alg: 'RS256',
        kid: KEY_ID,
        use: 'sig',
      },
    ],
  });
});

async function createIdentityToken(
  overrides: JWTPayload = {},
  signingKey: GeneratedKeyPair['privateKey'] = privateKey,
  omittedClaim?: 'exp' | 'iat' | 'sub',
): Promise<string> {
  const payload: JWTPayload = {
    iss: 'https://appleid.apple.com',
    aud: CLIENT_ID,
    sub: 'apple-subject',
    iat: NOW_SECONDS,
    exp: NOW_SECONDS + 600,
    email: 'user@example.com',
    email_verified: 'true',
    ...overrides,
  };

  if (omittedClaim !== undefined) {
    delete payload[omittedClaim];
  }

  return new SignJWT(payload).setProtectedHeader({ alg: 'RS256', kid: KEY_ID }).sign(signingKey);
}

function createVerifier(resolver: JWTVerifyGetKey = keyResolver): AppleIdentityTokenVerifier {
  return new AppleIdentityTokenVerifier(CLIENT_ID, {
    keyResolver: resolver,
    clock: () => NOW,
  });
}

describe('AppleIdentityTokenVerifier', () => {
  it('verifies and normalizes a valid Apple identity token', async () => {
    const verifier = createVerifier();

    await expect(verifier.verify(await createIdentityToken())).resolves.toEqual({
      providerId: 'apple-subject',
      email: 'user@example.com',
      emailVerified: true,
    });
  });

  it('verifies a token with a matching nonce', async () => {
    const verifier = createVerifier();
    const token = await createIdentityToken({ nonce: 'client-nonce-123' });

    await expect(verifier.verify(token, 'client-nonce-123')).resolves.toEqual({
      providerId: 'apple-subject',
      email: 'user@example.com',
      emailVerified: true,
    });
  });

  it('rejects a token whose nonce does not match the client nonce', async () => {
    const verifier = createVerifier();
    const token = await createIdentityToken({ nonce: 'server-nonce' });

    await expect(verifier.verify(token, 'client-nonce')).rejects.toBeInstanceOf(
      InvalidAppleIdentityTokenError,
    );
  });

  it('rejects a token missing a nonce claim when a client nonce is provided', async () => {
    const verifier = createVerifier();
    const token = await createIdentityToken();

    await expect(verifier.verify(token, 'client-nonce')).rejects.toBeInstanceOf(
      InvalidAppleIdentityTokenError,
    );
  });

  it('accepts boolean email verification claims', async () => {
    const verifier = createVerifier();

    await expect(
      verifier.verify(await createIdentityToken({ email_verified: false })),
    ).resolves.toEqual({
      providerId: 'apple-subject',
      email: 'user@example.com',
      emailVerified: false,
    });
  });

  it('normalizes an empty email to an absent unverified email', async () => {
    const verifier = createVerifier();

    await expect(verifier.verify(await createIdentityToken({ email: '' }))).resolves.toEqual({
      providerId: 'apple-subject',
      email: null,
      emailVerified: false,
    });
  });

  it.each([
    ['issuer', { iss: 'https://attacker.example' }],
    ['audience', { aud: 'another-client' }],
    ['expiration', { exp: NOW_SECONDS - 61 }],
    ['issued-at timestamp', { iat: NOW_SECONDS + 61 }],
    ['subject', { sub: '' }],
    ['email', { email: 'not-an-email' }],
    ['email verification', { email_verified: 'yes' }],
  ])('rejects an invalid %s claim', async (_claim, overrides) => {
    const verifier = createVerifier();

    await expect(verifier.verify(await createIdentityToken(overrides))).rejects.toBeInstanceOf(
      InvalidAppleIdentityTokenError,
    );
  });

  it.each([
    ['expiration', 'exp'],
    ['issued-at timestamp', 'iat'],
    ['subject', 'sub'],
  ] as const)('rejects a missing %s claim', async (_claim, omittedClaim) => {
    const verifier = createVerifier();

    await expect(
      verifier.verify(await createIdentityToken({}, privateKey, omittedClaim)),
    ).rejects.toBeInstanceOf(InvalidAppleIdentityTokenError);
  });

  it('rejects a token with an invalid signature', async () => {
    const verifier = createVerifier();

    await expect(
      verifier.verify(await createIdentityToken({}, otherPrivateKey)),
    ).rejects.toBeInstanceOf(InvalidAppleIdentityTokenError);
  });

  it('rejects a malformed compact token', async () => {
    const verifier = createVerifier();

    await expect(verifier.verify('not-a-jwt')).rejects.toBeInstanceOf(
      InvalidAppleIdentityTokenError,
    );
  });

  it('preserves identity provider availability failures', async () => {
    const unavailableResolver: JWTVerifyGetKey = () =>
      Promise.reject(new AppleIdentityProviderUnavailableError());
    const verifier = createVerifier(unavailableResolver);

    await expect(verifier.verify(await createIdentityToken())).rejects.toBeInstanceOf(
      AppleIdentityProviderUnavailableError,
    );
  });

  it.each([
    ['network failure', () => Promise.reject(new TypeError('network unavailable'))],
    ['timeout', () => Promise.reject(new DOMException('request timed out', 'TimeoutError'))],
  ] satisfies [string, FetchImplementation][])(
    'maps a remote JWKS %s to provider unavailability',
    async (_failure, fetchImplementation) => {
      const verifier = createVerifier(
        createAppleRemoteKeyResolver({
          [customFetch]: fetchImplementation,
        }),
      );

      await expect(verifier.verify(await createIdentityToken())).rejects.toBeInstanceOf(
        AppleIdentityProviderUnavailableError,
      );
    },
  );
});
