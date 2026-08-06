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

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super('Refresh token is invalid');
    this.name = 'InvalidRefreshTokenError';
  }
}
