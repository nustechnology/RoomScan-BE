import { AppError } from '../errors/app-error.js';
import {
  IdempotencyKeyConflictError,
  IdempotencyKeyRequiredError,
  InvalidIdempotencyKeyError,
} from './idempotency.errors.js';

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

export function resolveIdempotencyKey(
  headerValue: string | undefined,
  legacyValue?: string,
): string {
  const header = headerValue?.trim();
  const legacy = legacyValue?.trim();

  if (header !== undefined && header.length > 0 && legacy !== undefined && header !== legacy) {
    throw new InvalidIdempotencyKeyError(
      'Idempotency-Key header must match the deprecated body idempotency key',
    );
  }

  const key = header === undefined || header.length === 0 ? legacy : header;
  if (key === undefined || key.length === 0) {
    throw new IdempotencyKeyRequiredError();
  }
  if (key.length > 128 || hasControlCharacter(key)) {
    throw new InvalidIdempotencyKeyError();
  }

  return key;
}

export function idempotencyErrorToAppError(error: unknown): AppError | undefined {
  if (error instanceof IdempotencyKeyRequiredError) {
    return new AppError({
      statusCode: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'Idempotency-Key is required',
    });
  }
  if (error instanceof InvalidIdempotencyKeyError) {
    return new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: error.message,
    });
  }
  if (error instanceof IdempotencyKeyConflictError) {
    return new AppError({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_CONFLICT',
      message: 'Idempotency-Key was already used with a different request',
    });
  }
  return undefined;
}
