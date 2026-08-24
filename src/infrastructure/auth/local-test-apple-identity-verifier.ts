import {
  LOCAL_TEST_APPLE_IDENTITY_TOKEN,
  LOCAL_TEST_APPLE_PROVIDER_ID,
  LOCAL_TEST_PENDING_INVITE_APPLE_IDENTITY_TOKEN,
  LOCAL_TEST_PENDING_INVITE_PROVIDER_ID,
  LOCAL_TEST_PENDING_INVITE_EMAIL,
  LOCAL_TEST_USER_EMAIL,
} from '../../config/constants.js';
import type {
  AppleIdentityVerifier,
  VerifiedAppleIdentity,
} from '../../modules/auth/auth.types.js';

export interface LocalTestAppleIdentityVerifierOptions {
  delegate: AppleIdentityVerifier;
  enabled: boolean;
}

export class LocalTestAppleIdentityVerifier implements AppleIdentityVerifier {
  readonly #delegate: AppleIdentityVerifier;
  readonly #enabled: boolean;

  constructor({ delegate, enabled }: LocalTestAppleIdentityVerifierOptions) {
    this.#delegate = delegate;
    this.#enabled = enabled;
  }

  async verify(identityToken: string, nonce?: string): Promise<VerifiedAppleIdentity> {
    if (this.#enabled && identityToken === LOCAL_TEST_APPLE_IDENTITY_TOKEN) {
      return {
        providerId: LOCAL_TEST_APPLE_PROVIDER_ID,
        email: LOCAL_TEST_USER_EMAIL,
        emailVerified: true,
      };
    }
    if (this.#enabled && identityToken === LOCAL_TEST_PENDING_INVITE_APPLE_IDENTITY_TOKEN) {
      return {
        providerId: LOCAL_TEST_PENDING_INVITE_PROVIDER_ID,
        email: LOCAL_TEST_PENDING_INVITE_EMAIL,
        emailVerified: true,
      };
    }

    return await this.#delegate.verify(identityToken, nonce);
  }
}
