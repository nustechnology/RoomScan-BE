export interface VerifiedAppleIdentity {
  providerId: string;
  email: string | null;
  emailVerified: boolean;
}

export interface AppleIdentityVerifier {
  verify(identityToken: string, nonce?: string): Promise<VerifiedAppleIdentity>;
}

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  provider: 'apple';
}

export interface AppleUserRepository {
  upsertAppleUser(identity: VerifiedAppleIdentity): Promise<AuthenticatedUser>;
}

export interface AuthTokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthTokenIssuer {
  issueTokens(userId: string): Promise<AuthTokenPair>;
}

export interface AppleAuthResult extends AuthTokenPair {
  user: AuthenticatedUser;
}

export interface AppleAuthService {
  signInWithApple(identityToken: string, nonce?: string): Promise<AppleAuthResult>;
}
