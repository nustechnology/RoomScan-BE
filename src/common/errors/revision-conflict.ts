export class RevisionConflictError extends Error {
  constructor() {
    super('Resource revision does not match the server state');
    this.name = 'RevisionConflictError';
  }
}
