export class IdempotencyKeyRequiredError extends Error {
  constructor() {
    super('Idempotency-Key is required');
    this.name = 'IdempotencyKeyRequiredError';
  }
}

export class InvalidIdempotencyKeyError extends Error {
  constructor(message = 'Idempotency-Key is invalid') {
    super(message);
    this.name = 'InvalidIdempotencyKeyError';
  }
}

export class IdempotencyKeyConflictError extends Error {
  constructor() {
    super('Idempotency-Key was already used with a different request');
    this.name = 'IdempotencyKeyConflictError';
  }
}
