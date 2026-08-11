export class NoteNotFoundError extends Error {
  constructor() {
    super('Note was not found');
    this.name = 'NoteNotFoundError';
  }
}

export class ModelVersionMismatchError extends Error {
  constructor() {
    super('Model version does not match the scan model version');
    this.name = 'ModelVersionMismatchError';
  }
}
