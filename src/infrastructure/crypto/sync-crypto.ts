import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ENCRYPTION_VERSION = 1;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function sortJson(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }

  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export class SyncCrypto {
  readonly #encryptionKey: Buffer;
  readonly #cursorKey: Buffer;

  constructor(base64Key: string) {
    const masterKey = Buffer.from(base64Key, 'base64');
    if (masterKey.length !== 32) {
      throw new Error('SYNC_CRYPTO_KEY must decode to exactly 32 bytes');
    }

    this.#encryptionKey = Buffer.from(
      hkdfSync('sha256', masterKey, Buffer.alloc(0), 'roomscan-idempotency-receipt-v1', 32),
    );
    this.#cursorKey = Buffer.from(
      hkdfSync('sha256', masterKey, Buffer.alloc(0), 'roomscan-sync-cursor-v1', 32),
    );
  }

  hash(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex');
  }

  hashString(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  encryptJson(value: unknown): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.#encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(canonicalJson(value), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Uint8Array.from(Buffer.concat([Buffer.from([ENCRYPTION_VERSION]), iv, tag, ciphertext]));
  }

  decryptJson<T>(value: Uint8Array): T {
    const encoded = Buffer.from(value);
    const minimumLength = 1 + IV_LENGTH + AUTH_TAG_LENGTH;
    if (encoded.length < minimumLength || encoded[0] !== ENCRYPTION_VERSION) {
      throw new Error('Unsupported encrypted receipt');
    }

    const iv = encoded.subarray(1, 1 + IV_LENGTH);
    const tag = encoded.subarray(1 + IV_LENGTH, minimumLength);
    const ciphertext = encoded.subarray(minimumLength);
    const decipher = createDecipheriv('aes-256-gcm', this.#encryptionKey, iv);
    decipher.setAuthTag(tag);

    return JSON.parse(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
    ) as T;
  }

  signCursor(payload: unknown): string {
    const encodedPayload = Buffer.from(canonicalJson(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', this.#cursorKey)
      .update(encodedPayload)
      .digest('base64url');
    return `${encodedPayload}.${signature}`;
  }

  verifyCursor(token: string): unknown {
    const parts = token.split('.');
    if (parts.length !== 2) {
      throw new Error('Malformed cursor');
    }

    const [encodedPayload, encodedSignature] = parts;
    if (encodedPayload === undefined || encodedSignature === undefined) {
      throw new Error('Malformed cursor');
    }

    const supplied = Buffer.from(encodedSignature, 'base64url');
    const expected = createHmac('sha256', this.#cursorKey).update(encodedPayload).digest();
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new Error('Invalid cursor signature');
    }

    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as unknown;
  }
}
