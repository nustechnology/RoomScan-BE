import { AppError } from '../errors/app-error.js';

export function parseIfMatch(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  const unquoted =
    trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1)
      : trimmed;

  if (!/^\d+$/.test(unquoted)) {
    throw new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'If-Match must contain the resource revision',
    });
  }

  const revision = Number(unquoted);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'If-Match must contain a positive revision',
    });
  }

  return revision;
}
