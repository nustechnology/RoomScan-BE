export class ProjectNotFoundError extends Error {
  constructor() {
    super('Project was not found');
    this.name = 'ProjectNotFoundError';
  }
}
