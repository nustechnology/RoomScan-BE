import type {
  AppleAuthResult,
  AppleIdentityVerifier,
  AppleUserRepository,
  AuthTokenIssuer,
} from './auth.types.js';

export interface AuthServiceDependencies {
  appleIdentityVerifier: AppleIdentityVerifier;
  userRepository: AppleUserRepository;
  tokenIssuer: AuthTokenIssuer;
}

export class AuthService {
  readonly #appleIdentityVerifier: AppleIdentityVerifier;
  readonly #userRepository: AppleUserRepository;
  readonly #tokenIssuer: AuthTokenIssuer;

  constructor({ appleIdentityVerifier, userRepository, tokenIssuer }: AuthServiceDependencies) {
    this.#appleIdentityVerifier = appleIdentityVerifier;
    this.#userRepository = userRepository;
    this.#tokenIssuer = tokenIssuer;
  }

  async signInWithApple(identityToken: string, nonce?: string): Promise<AppleAuthResult> {
    const identity = await this.#appleIdentityVerifier.verify(identityToken, nonce);
    const user = await this.#userRepository.upsertAppleUser(identity);
    const tokens = await this.#tokenIssuer.issueTokens(user.id);

    return {
      ...tokens,
      user,
    };
  }
}
