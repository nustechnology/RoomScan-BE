export class NotSharedProjectError extends Error {
  constructor() {
    super('This project is not shared with you');
    this.name = 'NotSharedProjectError';
  }
}

export class SharedProjectNotInListError extends Error {
  constructor() {
    super('This project is not in your Shared With Me list');
    this.name = 'SharedProjectNotInListError';
  }
}
