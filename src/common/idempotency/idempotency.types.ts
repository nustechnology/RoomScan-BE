export type IdempotencyOperation =
  'CREATE_PROJECT' | 'CREATE_SCAN' | 'CREATE_NOTE' | 'CREATE_UPLOAD_SESSION' | 'CREATE_INVITATION';

export interface IdempotencyContext {
  userId: string;
  operation: IdempotencyOperation;
  parentScope: string;
  keyHash: string;
  requestHash: string;
}

export interface IdempotencyInput {
  userId: string;
  operation: IdempotencyOperation;
  parentScope: string;
  key: string;
  request: unknown;
}

export interface IdempotencyResult<T> {
  body: T;
  statusCode: number;
  replayed: boolean;
}

export interface IdempotencyGateway {
  createContext(input: IdempotencyInput): IdempotencyContext;
  lookup<T>(context: IdempotencyContext): Promise<IdempotencyResult<T> | null>;
}
