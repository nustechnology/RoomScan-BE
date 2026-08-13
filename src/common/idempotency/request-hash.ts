import { createHash } from 'node:crypto';

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
      .sort();
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashIdempotencyRequest(method: string, path: string, body: unknown): string {
  return createHash('sha256').update(canonicalize({ method, path, body })).digest('hex');
}
