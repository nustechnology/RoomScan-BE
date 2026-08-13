export class InvalidCursorError extends Error {
  constructor() {
    super('Sync cursor is invalid or expired');
    this.name = 'InvalidCursorError';
  }
}

export class SyncProjectNotFoundError extends Error {
  constructor() {
    super('Project was not found');
    this.name = 'SyncProjectNotFoundError';
  }
}
