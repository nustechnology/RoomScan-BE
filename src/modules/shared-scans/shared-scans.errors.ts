export class NotSharedScanError extends Error {
  constructor() {
    super('This scan is not shared with you');
    this.name = 'NotSharedScanError';
  }
}

export class SharedScanNotInListError extends Error {
  constructor() {
    super('This scan is not in your Shared With Me list');
    this.name = 'SharedScanNotInListError';
  }
}
