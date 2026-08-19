export class InvalidSyncCursorError extends Error {
  constructor() {
    super('Sync cursor is invalid');
    this.name = 'InvalidSyncCursorError';
  }
}

export class InvalidSyncTimestampError extends Error {
  constructor() {
    super('Sync timestamp is invalid');
    this.name = 'InvalidSyncTimestampError';
  }
}
