import type {
  AppleAuthResult,
  AppleIdentityVerifier,
  AppleUserRepository,
  AuthTokenIssuer,
  AuthTokenPair,
  RefreshTokenRepository,
  RefreshTokenVerifier,
} from './auth.types.js';
import { InvalidRefreshTokenError } from './auth.errors.js';

export interface AuthServiceDependencies {
  appleIdentityVerifier: AppleIdentityVerifier;
  userRepository: AppleUserRepository;
  tokenIssuer: AuthTokenIssuer;
  tokenRepository: RefreshTokenRepository;
}

export class AuthService {
  readonly #appleIdentityVerifier: AppleIdentityVerifier;
  readonly #userRepository: AppleUserRepository;
  readonly #tokenIssuer: AuthTokenIssuer;
  readonly #tokenRepository: RefreshTokenRepository;

  constructor({
    appleIdentityVerifier,
    userRepository,
    tokenIssuer,
    tokenRepository,
  }: AuthServiceDependencies) {
    this.#appleIdentityVerifier = appleIdentityVerifier;
    this.#userRepository = userRepository;
    this.#tokenIssuer = tokenIssuer;
    this.#tokenRepository = tokenRepository;
  }

  async signInWithApple(identityToken: string, nonce?: string): Promise<AppleAuthResult> {
    const identity = await this.#appleIdentityVerifier.verify(identityToken, nonce);
    const user = await this.#userRepository.upsertAppleUser(identity);
    const tokens = await this.#tokenIssuer.issueTokens(user.id);

    await this.#tokenRepository.saveToken(
      tokens.refreshTokenJti,
      user.id,
      tokens.refreshTokenExpiresAt,
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user,
    };
  }
}

export interface RefreshTokenServiceDependencies {
  tokenVerifier: RefreshTokenVerifier;
  tokenRepository: RefreshTokenRepository;
  tokenIssuer: AuthTokenIssuer;
}

export class RefreshTokenService {
  readonly #tokenVerifier: RefreshTokenVerifier;
  readonly #tokenRepository: RefreshTokenRepository;
  readonly #tokenIssuer: AuthTokenIssuer;

  constructor({ tokenVerifier, tokenRepository, tokenIssuer }: RefreshTokenServiceDependencies) {
    this.#tokenVerifier = tokenVerifier;
    this.#tokenRepository = tokenRepository;
    this.#tokenIssuer = tokenIssuer;
  }

  async refresh(rawToken: string): Promise<AuthTokenPair> {
    const { userId, jti } = await this.#tokenVerifier.verify(rawToken);

    const tokens = await this.#tokenIssuer.issueTokens(userId);

    const rotated = await this.#tokenRepository.rotate(
      jti,
      tokens.refreshTokenJti,
      userId,
      tokens.refreshTokenExpiresAt,
    );
    if (!rotated) {
      throw new InvalidRefreshTokenError();
    }

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }
}
