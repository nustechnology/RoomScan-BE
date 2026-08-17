import { describe, expect, it, vi } from 'vitest';

import { IdempotencyKeyConflictError } from '../src/common/idempotency/idempotency.errors.js';
import {
  idempotencyErrorToAppError,
  resolveIdempotencyKey,
} from '../src/common/idempotency/idempotency.js';
import { parseIfMatch, revisionErrorToAppError } from '../src/common/revision/revision.js';
import { RevisionConflictError } from '../src/common/revision/revision.errors.js';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { SyncCrypto } from '../src/infrastructure/crypto/sync-crypto.js';
import { PrismaIdempotencyExecutor } from '../src/infrastructure/database/prisma-idempotency.js';

const USER_ID = 'eb5d278f-c857-45c7-887d-7be65288cb75';
const KEY = Buffer.alloc(32, 9).toString('base64');

describe('idempotency key validation', () => {
  it('trims the selected key, accepts non-control Unicode, and validates legacy aliases', () => {
    expect(resolveIdempotencyKey('  retry key ✓  ')).toBe('retry key ✓');
    expect(resolveIdempotencyKey(undefined, 'legacy-key')).toBe('legacy-key');
    expect(resolveIdempotencyKey('same-key', 'same-key')).toBe('same-key');
  });

  it('returns stable errors for missing, invalid, conflicting, and mismatched keys', () => {
    expect(idempotencyErrorToAppError(capture(() => resolveIdempotencyKey(undefined)))?.code).toBe(
      'IDEMPOTENCY_KEY_REQUIRED',
    );
    expect(
      idempotencyErrorToAppError(capture(() => resolveIdempotencyKey('bad\u0001key')))?.code,
    ).toBe('VALIDATION_ERROR');
    expect(
      idempotencyErrorToAppError(capture(() => resolveIdempotencyKey('header', 'body')))?.code,
    ).toBe('VALIDATION_ERROR');
    expect(idempotencyErrorToAppError(new IdempotencyKeyConflictError())?.code).toBe(
      'IDEMPOTENCY_KEY_CONFLICT',
    );
    expect(idempotencyErrorToAppError(new Error('other'))).toBeUndefined();
  });
});

describe('PrismaIdempotencyExecutor', () => {
  it('stores only hashes and encrypted response data, then replays the original status and body', async () => {
    const crypto = new SyncCrypto(KEY);
    const create = vi.fn().mockResolvedValue({});
    const findUnique = vi.fn().mockResolvedValue(null);
    const transaction = vi.fn(
      async (work: (tx: unknown) => Promise<unknown>) =>
        await work({ idempotencyReceipt: { create } }),
    );
    const executor = new PrismaIdempotencyExecutor(
      { idempotencyReceipt: { findUnique }, $transaction: transaction } as unknown as Pick<
        PrismaClient,
        'idempotencyReceipt' | '$transaction'
      >,
      crypto,
    );
    const context = executor.createContext({
      userId: USER_ID,
      operation: 'CREATE_PROJECT',
      parentScope: 'user',
      key: 'raw-key-never-persisted',
      request: { name: 'Room' },
    });

    await expect(
      executor.execute(context, 201, () => Promise.resolve({ id: 'project-id' })),
    ).resolves.toEqual({ body: { id: 'project-id' }, statusCode: 201, replayed: false });
    const [createArguments] = create.mock.calls[0] as unknown as [
      { data: Record<string, unknown> },
    ];
    const data = createArguments.data;
    expect(data).toMatchObject({
      userId: USER_ID,
      operation: 'CREATE_PROJECT',
      parentScope: 'user',
      responseStatus: 201,
    });
    expect(data.keyHash).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(data.requestHash).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(JSON.stringify(data)).not.toContain('raw-key-never-persisted');

    findUnique.mockResolvedValueOnce({
      requestHash: context.requestHash,
      responseStatus: 201,
      responseCiphertext: data.responseCiphertext,
    });
    await expect(executor.lookup(context)).resolves.toEqual({
      body: { id: 'project-id' },
      statusCode: 201,
      replayed: true,
    });
  });

  it('rejects a reused key with a different canonical request', async () => {
    const crypto = new SyncCrypto(KEY);
    const executor = new PrismaIdempotencyExecutor(
      {
        idempotencyReceipt: {
          findUnique: vi.fn().mockResolvedValue({
            requestHash: 'different',
            responseStatus: 201,
            responseCiphertext: crypto.encryptJson({ id: 'original' }),
          }),
        },
        $transaction: vi.fn(),
      } as unknown as Pick<PrismaClient, 'idempotencyReceipt' | '$transaction'>,
      crypto,
    );
    const context = executor.createContext({
      userId: USER_ID,
      operation: 'CREATE_PROJECT',
      parentScope: 'user',
      key: 'same-key',
      request: { name: 'different' },
    });

    await expect(executor.lookup(context)).rejects.toBeInstanceOf(IdempotencyKeyConflictError);
  });

  it('replays the committed winner after a concurrent receipt unique conflict', async () => {
    const crypto = new SyncCrypto(KEY);
    const contextInput = {
      userId: USER_ID,
      operation: 'CREATE_NOTE' as const,
      parentScope: 'scan:abc',
      key: 'concurrent',
      request: { content: 'note' },
    };
    const conflict = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const findUnique = vi.fn().mockResolvedValueOnce(null);
    const executor = new PrismaIdempotencyExecutor(
      {
        idempotencyReceipt: { findUnique },
        $transaction: vi.fn().mockRejectedValue(conflict),
      } as unknown as Pick<PrismaClient, 'idempotencyReceipt' | '$transaction'>,
      crypto,
    );
    const context = executor.createContext(contextInput);
    findUnique.mockResolvedValueOnce({
      requestHash: context.requestHash,
      responseStatus: 201,
      responseCiphertext: crypto.encryptJson({ id: 'winner' }),
    });

    await expect(
      executor.execute(context, 201, () => Promise.resolve({ id: 'loser' })),
    ).resolves.toEqual({
      body: { id: 'winner' },
      statusCode: 201,
      replayed: true,
    });
  });
});

describe('revision headers', () => {
  it('accepts only positive strong numeric ETags', () => {
    expect(parseIfMatch(' "12" ')).toBe(12);
    expect(revisionErrorToAppError(capture(() => parseIfMatch(undefined)))?.code).toBe(
      'REVISION_REQUIRED',
    );
    for (const value of ['W/"1"', '1', '"0"', '"01"', '"99999999999999999999"']) {
      expect(revisionErrorToAppError(capture(() => parseIfMatch(value)))?.code).toBe(
        'INVALID_REVISION',
      );
    }
  });

  it('maps stale revisions to the standard conflict details', () => {
    const mapped = revisionErrorToAppError(
      new RevisionConflictError({
        projectId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
        resourceType: 'PROJECT',
        resourceId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
        currentRevision: 7,
        deleted: true,
      }),
    );
    expect(mapped).toMatchObject({
      statusCode: 409,
      code: 'REVISION_CONFLICT',
      details: { currentRevision: 7, deleted: true },
    });
    expect(revisionErrorToAppError(new Error('other'))).toBeUndefined();
  });
});

function capture(work: () => unknown): unknown {
  try {
    work();
    return undefined;
  } catch (error) {
    return error;
  }
}
