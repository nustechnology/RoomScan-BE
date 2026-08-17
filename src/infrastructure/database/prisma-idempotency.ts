import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { IdempotencyKeyConflictError } from '../../common/idempotency/idempotency.errors.js';
import type {
  IdempotencyContext,
  IdempotencyGateway,
  IdempotencyInput,
  IdempotencyResult,
} from '../../common/idempotency/idempotency.types.js';
import type { SyncCrypto } from '../crypto/sync-crypto.js';

export type PrismaTransactionClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

type IdempotencyClient = Pick<PrismaClient, 'idempotencyReceipt' | '$transaction'>;

export class PrismaIdempotencyExecutor implements IdempotencyGateway {
  readonly #client: IdempotencyClient;
  readonly #crypto: SyncCrypto;

  constructor(client: IdempotencyClient, crypto: SyncCrypto) {
    this.#client = client;
    this.#crypto = crypto;
  }

  createContext(input: IdempotencyInput): IdempotencyContext {
    return {
      userId: input.userId,
      operation: input.operation,
      parentScope: input.parentScope,
      keyHash: this.#crypto.hashString(input.key),
      requestHash: this.#crypto.hash({
        operation: input.operation,
        parentScope: input.parentScope,
        request: input.request,
      }),
    };
  }

  async lookup<T>(context: IdempotencyContext): Promise<IdempotencyResult<T> | null> {
    const receipt = await this.#client.idempotencyReceipt.findUnique({
      where: {
        userId_operation_parentScope_keyHash: {
          userId: context.userId,
          operation: context.operation,
          parentScope: context.parentScope,
          keyHash: context.keyHash,
        },
      },
      select: {
        requestHash: true,
        responseStatus: true,
        responseCiphertext: true,
      },
    });

    if (receipt === null) {
      return null;
    }
    if (receipt.requestHash !== context.requestHash) {
      throw new IdempotencyKeyConflictError();
    }

    return {
      body: this.#crypto.decryptJson<T>(receipt.responseCiphertext),
      statusCode: receipt.responseStatus,
      replayed: true,
    };
  }

  async execute<T>(
    context: IdempotencyContext,
    statusCode: number,
    work: (transaction: PrismaTransactionClient) => Promise<T>,
  ): Promise<IdempotencyResult<T>> {
    const replay = await this.lookup<T>(context);
    if (replay !== null) {
      return replay;
    }

    try {
      const responseBody = await this.#client.$transaction(async (transaction) => {
        const result = await work(transaction);
        await transaction.idempotencyReceipt.create({
          data: {
            userId: context.userId,
            operation: context.operation,
            parentScope: context.parentScope,
            keyHash: context.keyHash,
            requestHash: context.requestHash,
            responseStatus: statusCode,
            responseCiphertext: this.#crypto.encryptJson(result),
          },
        });
        return result;
      });

      return { body: responseBody, statusCode, replayed: false };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const concurrentReplay = await this.lookup<T>(context);
        if (concurrentReplay !== null) {
          return concurrentReplay;
        }
      }
      throw error;
    }
  }
}
