export class IdempotencyKeyMismatchError extends Error {
  constructor() {
    super('Idempotency-Key was already used with a different request body');
    this.name = 'IdempotencyKeyMismatchError';
  }
}

export class IdempotencyKeyInProgressError extends Error {
  constructor() {
    super('A request with the same Idempotency-Key is already being processed');
    this.name = 'IdempotencyKeyInProgressError';
  }
}
