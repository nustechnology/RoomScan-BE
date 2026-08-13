import { InvalidCursorError } from './sync.errors.js';

export interface SyncCursorValue {
  updatedAt: number;
  id: string;
}

export function encodeSyncCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ v: updatedAt.getTime(), id }), 'utf8').toString('base64url');
}

export function decodeSyncCursor(cursor: string | undefined): SyncCursorValue | null {
  if (cursor === undefined) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      v?: unknown;
      id?: unknown;
    };

    if (
      typeof parsed.v !== 'number' ||
      !Number.isFinite(parsed.v) ||
      typeof parsed.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)
    ) {
      throw new InvalidCursorError();
    }

    return { updatedAt: parsed.v, id: parsed.id };
  } catch {
    throw new InvalidCursorError();
  }
}
