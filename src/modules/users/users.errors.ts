export class UserNotFoundError extends Error {
  constructor() {
    super('User was not found');
    this.name = 'UserNotFoundError';
  }
}
