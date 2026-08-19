import { z } from 'zod';

import type { SyncCrypto } from '../../infrastructure/crypto/sync-crypto.js';
import { ProjectNotFoundError } from '../project/project.errors.js';
import { InvalidSyncCursorError, InvalidSyncTimestampError } from './sync.errors.js';
import type {
  SyncChangeRecord,
  SyncChangeResultItem,
  SyncChangesResult,
  SyncRepository,
  SyncResourceType,
  SyncStatusResult,
} from './sync.types.js';

const ResourceTypeSchema = z.enum(['PROJECT', 'SCAN', 'NOTE', 'SCAN_ASSET', 'PROJECT_ACCESS']);
const SnapshotCursorSchema = z.object({
  v: z.literal(1),
  mode: z.literal('snapshot'),
  userId: z.uuid(),
  watermark: z.string().regex(/^\d+$/),
  afterType: ResourceTypeSchema.optional(),
  afterId: z.uuid().optional(),
});
const IncrementalCursorSchema = z.object({
  v: z.literal(1),
  mode: z.literal('incremental'),
  userId: z.uuid(),
  after: z.string().regex(/^\d+$/),
  since: z.iso.datetime({ offset: true }).optional(),
});
const CursorSchema = z.discriminatedUnion('mode', [SnapshotCursorSchema, IncrementalCursorSchema]);

type Cursor = z.infer<typeof CursorSchema>;

export interface SyncServiceDependencies {
  repository: SyncRepository;
  crypto: SyncCrypto;
  clock?: () => Date;
}

function toResult(record: SyncChangeRecord, cursor: string): SyncChangeResultItem {
  return {
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    operation: record.operation,
    revision: record.revision,
    syncStatus: record.syncStatus,
    changedAt: record.changedAt.toISOString(),
    cursor,
    deletedAt: record.deletedAt?.toISOString() ?? null,
    data: record.data,
  };
}

export class SyncService {
  readonly #repository: SyncRepository;
  readonly #crypto: SyncCrypto;
  readonly #clock: () => Date;

  constructor({ repository, crypto, clock }: SyncServiceDependencies) {
    this.#repository = repository;
    this.#crypto = crypto;
    this.#clock = clock ?? (() => new Date());
  }

  #encodeSnapshotCursor(
    userId: string,
    watermark: bigint,
    after?: { resourceType: SyncResourceType; resourceId: string },
  ): string {
    return this.#crypto.signCursor({
      v: 1,
      mode: 'snapshot',
      userId,
      watermark: watermark.toString(),
      ...(after === undefined ? {} : { afterType: after.resourceType, afterId: after.resourceId }),
    });
  }

  #encodeIncrementalCursor(userId: string, after: bigint, since: Date | null = null): string {
    return this.#crypto.signCursor({
      v: 1,
      mode: 'incremental',
      userId,
      after: after.toString(),
      ...(since === null ? {} : { since: since.toISOString() }),
    });
  }

  #decodeCursor(token: string, userId: string): Cursor {
    try {
      const cursor = CursorSchema.parse(this.#crypto.verifyCursor(token));
      if (cursor.userId !== userId) {
        throw new InvalidSyncCursorError();
      }
      if (
        cursor.mode === 'snapshot' &&
        (cursor.afterType === undefined) !== (cursor.afterId === undefined)
      ) {
        throw new InvalidSyncCursorError();
      }
      return cursor;
    } catch (error) {
      if (error instanceof InvalidSyncCursorError) {
        throw error;
      }
      throw new InvalidSyncCursorError();
    }
  }

  async #snapshot(
    userId: string,
    limit: number,
    cursor?: Extract<Cursor, { mode: 'snapshot' }>,
  ): Promise<SyncChangesResult> {
    const watermark =
      cursor === undefined ? await this.#repository.getWatermark() : BigInt(cursor.watermark);
    const after =
      cursor?.afterType === undefined || cursor.afterId === undefined
        ? null
        : { resourceType: cursor.afterType, resourceId: cursor.afterId };
    const page = await this.#repository.listSnapshot(userId, watermark, after, limit);
    const changes = page.items.map((item) =>
      toResult(
        item,
        this.#encodeSnapshotCursor(userId, watermark, {
          resourceType: item.resourceType,
          resourceId: item.resourceId,
        }),
      ),
    );
    const last = page.items.at(-1);
    const nextCursor =
      page.hasMore && last !== undefined
        ? this.#encodeSnapshotCursor(userId, watermark, {
            resourceType: last.resourceType,
            resourceId: last.resourceId,
          })
        : this.#encodeIncrementalCursor(userId, watermark);

    return { changes, nextCursor };
  }

  async #incremental(
    userId: string,
    limit: number,
    afterSequence: bigint,
    since: Date | null,
  ): Promise<SyncChangesResult> {
    if (afterSequence > 0n) {
      await this.#repository.acknowledge(userId, afterSequence, this.#clock());
    }

    const watermark = await this.#repository.getWatermark();
    const page = await this.#repository.listIncremental(
      userId,
      afterSequence,
      watermark,
      since,
      limit,
    );
    const changes = page.items.map((item) =>
      toResult(item, this.#encodeIncrementalCursor(userId, item.sequence, since)),
    );
    const nextSequence = page.items.at(-1)?.sequence ?? watermark;

    return {
      changes,
      nextCursor: this.#encodeIncrementalCursor(userId, nextSequence, since),
    };
  }

  async getChanges(
    userId: string,
    input: { since?: string; cursor?: string; limit: number },
  ): Promise<SyncChangesResult> {
    if (input.cursor !== undefined && input.since !== undefined) {
      throw new InvalidSyncCursorError();
    }
    if (input.cursor !== undefined) {
      const cursor = this.#decodeCursor(input.cursor, userId);
      return cursor.mode === 'snapshot'
        ? await this.#snapshot(userId, input.limit, cursor)
        : await this.#incremental(
            userId,
            input.limit,
            BigInt(cursor.after),
            cursor.since === undefined ? null : new Date(cursor.since),
          );
    }

    if (input.since !== undefined) {
      if (!z.iso.datetime({ offset: true }).safeParse(input.since).success) {
        throw new InvalidSyncTimestampError();
      }
      const since = new Date(input.since);
      return await this.#incremental(userId, input.limit, 0n, since);
    }

    return await this.#snapshot(userId, input.limit);
  }

  async getStatus(userId: string, projectId?: string): Promise<SyncStatusResult> {
    const items = await this.#repository.listStatuses(userId, projectId);
    if (projectId !== undefined && items.length === 0) {
      throw new ProjectNotFoundError();
    }
    return { items };
  }
}
