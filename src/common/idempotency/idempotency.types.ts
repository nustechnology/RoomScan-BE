export interface IdempotencyRecord {
  id: string;
  userId: string;
  key: string;
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
}

export interface IdempotencyReserveInput {
  userId: string;
  key: string;
  requestHash: string;
  expiresAt: Date;
}

export interface IdempotencyRepository {
  findByUserAndKey(userId: string, key: string): Promise<IdempotencyRecord | null>;
  reserve(input: IdempotencyReserveInput): Promise<void>;
  finalize(userId: string, key: string, statusCode: number, responseBody: unknown): Promise<void>;
  release(userId: string, key: string): Promise<void>;
}
