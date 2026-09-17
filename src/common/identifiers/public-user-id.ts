import { randomInt } from 'node:crypto';

/**
 * Alphabet for the human-shareable public user id. It omits the characters
 * people confuse when they read an id out loud or retype it: `0`/`O`, `1`/`I`/`L`
 * and `U`. Ids are therefore always uppercase and unambiguous.
 */
export const PUBLIC_USER_ID_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

export const PUBLIC_USER_ID_LENGTH = 10;

/**
 * Accepts either case because a user may retype their id in either. The lower
 * case half is spelled out in the character class rather than set through the
 * `i` flag: the pattern is published in OpenAPI, where a flag suffix would make
 * it an invalid ECMA-262 pattern for generated clients.
 */
const PUBLIC_USER_ID_CHARACTER_CLASS = [
  ...new Set(PUBLIC_USER_ID_ALPHABET + PUBLIC_USER_ID_ALPHABET.toLowerCase()),
].join('');

export const PUBLIC_USER_ID_PATTERN = new RegExp(
  `^[${PUBLIC_USER_ID_CHARACTER_CLASS}]{${PUBLIC_USER_ID_LENGTH}}$`,
);

/**
 * Generates a public user id with ~49 bits of entropy (30^10). Uniqueness is
 * still enforced by the `users_publicId_key` unique index; callers retry on a
 * collision rather than trusting entropy alone.
 */
export function generatePublicUserId(): string {
  let id = '';

  for (let index = 0; index < PUBLIC_USER_ID_LENGTH; index += 1) {
    id += PUBLIC_USER_ID_ALPHABET[randomInt(0, PUBLIC_USER_ID_ALPHABET.length)];
  }

  return id;
}

/**
 * Normalizes user-supplied input to the canonical stored form. Returns `null`
 * when the value is not a well-formed public user id.
 */
export function normalizePublicUserId(value: string): string | null {
  const trimmed = value.trim();

  return PUBLIC_USER_ID_PATTERN.test(trimmed) ? trimmed.toUpperCase() : null;
}
