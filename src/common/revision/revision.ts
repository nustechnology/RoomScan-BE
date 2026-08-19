import type { Response } from 'express';

import { AppError } from '../errors/app-error.js';
import {
  InvalidRevisionError,
  RevisionConflictError,
  RevisionRequiredError,
} from './revision.errors.js';

const STRONG_ETAG_PATTERN = /^"([1-9]\d*)"$/;

export function parseIfMatch(value: string | undefined): number {
  if (value === undefined || value.trim().length === 0) {
    throw new RevisionRequiredError();
  }
  const match = STRONG_ETAG_PATTERN.exec(value.trim());
  if (match === null) {
    throw new InvalidRevisionError();
  }
  const revision = Number(match[1]);
  if (!Number.isSafeInteger(revision) || revision <= 0) {
    throw new InvalidRevisionError();
  }
  return revision;
}

export function setRevisionEtag(response: Response, revision: number): void {
  response.setHeader('ETag', `"${revision}"`);
}

export function revisionErrorToAppError(error: unknown): AppError | undefined {
  if (error instanceof RevisionRequiredError) {
    return new AppError({
      statusCode: 400,
      code: 'REVISION_REQUIRED',
      message: 'If-Match revision is required',
    });
  }
  if (error instanceof InvalidRevisionError) {
    return new AppError({
      statusCode: 400,
      code: 'INVALID_REVISION',
      message: 'If-Match revision is invalid',
    });
  }
  if (error instanceof RevisionConflictError) {
    return new AppError({
      statusCode: 409,
      code: 'REVISION_CONFLICT',
      message: 'The resource revision is stale',
      details: {
        currentRevision: error.currentRevision,
        deleted: error.deleted,
      },
    });
  }
  return undefined;
}
