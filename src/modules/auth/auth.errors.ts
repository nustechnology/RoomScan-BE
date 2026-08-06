import { AppError } from '../../common/errors/app-error.js';

export class InvalidAppleIdentityTokenError extends Error {
  constructor() {
    super('Apple identity token is invalid');
    this.name = 'InvalidAppleIdentityTokenError';
  }
}

export class AppleIdentityProviderUnavailableError extends Error {
  constructor() {
    super('Apple identity provider is unavailable');
    this.name = 'AppleIdentityProviderUnavailableError';
  }
}

export class InvalidRefreshTokenError extends AppError {
  constructor() {
    super({ statusCode: 401, code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid' });
  }
}
