import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { IdempotencyKeyInProgressError } from '../../common/idempotency/idempotency.errors.js';
import type {
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyReserveInput,
} from '../../common/idempotency/idempotency.types.js';

const idempotencySelect = {
  id: true,
  userId: true,
  key: true,
  requestHash: true,
  statusCode: true,
  responseBody: true,
  createdAt: true,
  expiresAt: true,
} as const;

interface IdempotencyRow {
  id: string;
  userId: string;
  key: string;
  requestHash: string;
  statusCode: number;
  responseBody: Prisma.JsonValue;
  createdAt: Date;
  expiresAt: Date;
}

function toRecord(row: IdempotencyRow): IdempotencyRecord {
  return {
    id: row.id,
    userId: row.userId,
    key: row.key,
    requestHash: row.requestHash,
    statusCode: row.statusCode,
    responseBody: row.responseBody === null ? null : row.responseBody,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

export class PrismaIdempotencyRepository implements IdempotencyRepository {
  readonly #client: Pick<PrismaClient, 'idempotencyRecord'>;

  constructor(client: Pick<PrismaClient, 'idempotencyRecord'>) {
    this.#client = client;
  }

  async findByUserAndKey(userId: string, key: string): Promise<IdempotencyRecord | null> {
    const row = await this.#client.idempotencyRecord.findUnique({
      where: { userId_key: { userId, key } },
      select: idempotencySelect,
    });

    return row === null ? null : toRecord(row);
  }

  async reserve(input: IdempotencyReserveInput): Promise<void> {
    try {
      await this.#client.idempotencyRecord.create({
        data: {
          userId: input.userId,
          key: input.key,
          requestHash: input.requestHash,
          statusCode: 0,
          responseBody: Prisma.JsonNull,
          expiresAt: input.expiresAt,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new IdempotencyKeyInProgressError();
      }
      throw error;
    }
  }

  async finalize(
    userId: string,
    key: string,
    statusCode: number,
    responseBody: unknown,
  ): Promise<void> {
    await this.#client.idempotencyRecord.updateMany({
      where: { userId, key },
      data: {
        statusCode,
        responseBody: responseBody as Prisma.InputJsonValue,
      },
    });
  }

  async release(userId: string, key: string): Promise<void> {
    await this.#client.idempotencyRecord.deleteMany({
      where: { userId, key },
    });
  }
}
