export class ScanNotFoundError extends Error {
  constructor() {
    super('Scan was not found');
    this.name = 'ScanNotFoundError';
  }
}
