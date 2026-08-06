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

export interface IssuedTokenPair extends AuthTokenPair {
  refreshTokenJti: string;
  refreshTokenExpiresAt: Date;
}

export interface AuthTokenIssuer {
  issueTokens(userId: string): Promise<IssuedTokenPair>;
}

export interface AppleAuthResult extends AuthTokenPair {
  user: AuthenticatedUser;
}

export interface AppleAuthService {
  signInWithApple(identityToken: string, nonce?: string): Promise<AppleAuthResult>;
}

export interface VerifiedRefreshToken {
  userId: string;
  jti: string;
}

export interface RefreshTokenVerifier {
  verify(token: string): Promise<VerifiedRefreshToken>;
}

export interface RefreshTokenRepository {
  saveToken(jti: string, userId: string, expiresAt: Date): Promise<void>;
  findActiveByJti(jti: string): Promise<{ userId: string; expiresAt: Date } | null>;
  revokeByJti(jti: string): Promise<void>;
}

export interface TokenRefreshService {
  refresh(refreshToken: string): Promise<AuthTokenPair>;
}
