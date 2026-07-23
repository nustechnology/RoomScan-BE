import { randomUUID } from 'node:crypto';

import type { Request } from 'express';

export function getRequestId(request: Request): string {
  const requestId = request.id;

  if (typeof requestId === 'string' && requestId.length > 0) {
    return requestId;
  }

  const header = request.header('x-request-id');
  return header !== undefined && header.length > 0 ? header : randomUUID();
}
