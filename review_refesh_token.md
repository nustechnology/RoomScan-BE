## Findings

### [Critical] [findActiveByJti](src/modules/auth/auth.types.ts:48:2-48:83) does not filter on `revokedAt` — revoked tokens can be reused

- **Location:** `src/infrastructure/database/prisma-refresh-token-repository.ts:21-35`
- **Trigger:** Any client that presents an already-rotated token before its `expiresAt`. After one successful rotation, the old token's record has `revokedAt` set but `expiresAt` still in the future. `findUnique` fetches the record by `jti` with no `revokedAt: null` filter; only `expiresAt` is checked.
- **Impact:** The revoked token remains "active" and can be rotated again. [revokeByJti](src/modules/auth/auth.types.ts:49:2-49:41) with `where: { jti, revokedAt: null }` silently updates 0 rows (already revoked), then a new pair is issued. Token rotation is completely bypassed — the entire stateful-revocation security model is broken.
- **Remediation:** Replace `findUnique` (which cannot take non-unique filters) with `findFirst` and add `revokedAt: null`:

```typescript
const record = await this.#client.refreshToken.findFirst({
  where: { jti, revokedAt: null },
  select: { userId: true, expiresAt: true },
});
```

---

### [Critical] [AuthService.signInWithApple](src/modules/auth/auth.service.ts:28:2-37:3) never persists the issued refresh token JTI — the refresh endpoint is non-functional for sign-in tokens

- **Location:** `src/modules/auth/auth.service.ts:29-38`
- **Trigger:** Any user signs in with Apple, receives a refresh token, then calls `POST /api/v1/auth/refresh` with it.
- **Impact:** [findActiveByJti](src/modules/auth/auth.types.ts:48:2-48:83) returns `null` (no row was ever inserted for the jti), so every refresh call returns `401 INVALID_REFRESH_TOKEN`. The refresh endpoint is completely broken for its primary use case.
- **Remediation:** [AuthService](src/modules/auth/auth.service.ts:17:0-38:1) must persist the issued refresh token JTI on sign-in, exactly as [RefreshTokenService](src/modules/auth/auth.service.ts:46:0-79:1) does on rotation. This requires [AuthService](src/modules/auth/auth.service.ts:17:0-38:1) to also receive [RefreshTokenRepository](src/modules/auth/auth.types.ts:46:0-50:1) as a dependency. This is coupled with Finding 3 below.

---

### [Required] Service decodes newly-issued JWT payload with unsafe type cast instead of extending [AuthTokenIssuer](src/modules/auth/auth.types.ts:25:0-27:1)

- **Location:** `src/modules/auth/auth.service.ts:70-76`
- **Trigger:** Every token rotation.
- **Impact:** Business logic in the service layer manually splits the JWT string and `JSON.parse`s the base64url payload with a bare `as { jti: string; exp: number }` cast. This bypasses the architecture's infrastructure boundary, is unverified (no signature check on what was just issued), and would silently produce wrong `jti`/`expiresAt` data if the token structure changes. It is also the root cause that forces both Finding 1 and Finding 2 to be coupled: without metadata from [issueTokens](src/modules/auth/auth.types.ts:26:2-26:53), both services must decode the token themselves.
- **Remediation:** Extend [AuthTokenIssuer](src/modules/auth/auth.types.ts:25:0-27:1) to return the metadata needed for persistence:

```typescript
export interface IssuedTokenPair extends AuthTokenPair {
  refreshTokenJti: string;
  refreshTokenExpiresAt: Date;
}

export interface AuthTokenIssuer {
  issueTokens(userId: string): Promise<IssuedTokenPair>;
}
```

[JoseAuthTokenIssuer](src/infrastructure/auth/jwt-token-issuer.ts:15:0-80:1) computes these values during signing and can return them directly. Both [AuthService](src/modules/auth/auth.service.ts:17:0-38:1) and [RefreshTokenService](src/modules/auth/auth.service.ts:46:0-79:1) then call [saveToken](src/modules/auth/auth.types.ts:47:2-47:72) without parsing JWT strings.

---

### [Required] No tests for [PrismaRefreshTokenRepository](src/infrastructure/database/prisma-refresh-token-repository.ts:3-42) — the `revokedAt` bug is invisible to CI

- **Location:** [test/](test:0:0-0:0) (absent file: `prisma-refresh-token-repository.test.ts`)
- **Trigger:** The critical repository layer has no unit or integration tests. The `revokedAt` filtering defect (Finding 1) cannot be caught by the test suite.
- **Impact:** Merging this change gives false confidence: `yarn test:coverage` passes while a Critical security regression ships.
- **Remediation:** Add a test for [PrismaRefreshTokenRepository](src/infrastructure/database/prisma-refresh-token-repository.ts:3:0-42:1) covering: active token found, revoked token returns null, expired token returns null, unknown jti returns null.

---

## Open questions and assumptions

- **Assumption:** The intent is that refresh tokens issued during Apple Sign-In are also subject to stateful rotation (i.e., must be saved to DB on [signInWithApple](src/modules/auth/auth.service.ts:28:2-37:3)). If the design intent is "stateless for first issuance, stateful only after first rotation," that must be explicitly documented and the [findActiveByJti](src/modules/auth/auth.types.ts:48:2-48:83) check on first use would still fail — so the only consistent model is to save on sign-in too.

---

## Verification

- **Not run:** `yarn validate`, `yarn test:coverage`, `yarn build` — Ask mode; cannot execute commands. The two Critical bugs above would not be caught by the current test suite because tests mock the service layer.
- **Manual trace:** Confirmed the revocation bypass (Finding 1) and the missing persist-on-sign-in (Finding 2) by reading the full call path from [auth.service.ts](src/modules/auth/auth.service.ts:0:0-0:0) → [prisma-refresh-token-repository.ts](src/infrastructure/database/prisma-refresh-token-repository.ts:0:0-0:0).

---

## Verdict

**Request changes** — two Critical bugs must be fixed before merge:

1. [findActiveByJti](src/modules/auth/auth.types.ts:48:2-48:83) must filter `revokedAt: null` (revoked tokens are currently reusable).
2. [signInWithApple](src/modules/auth/auth.service.ts:28:2-37:3) must persist the issued refresh JTI (the endpoint is currently non-functional end-to-end).

Both fixes are cleanest if [AuthTokenIssuer.issueTokens](src/modules/auth/auth.types.ts:26:2-26:53) is extended to return `jti` + `expiresAt` metadata, removing the unsafe JWT-decode workaround in the service layer. The repository test gap must also be resolved before handoff per the repo's documentation-governance and coverage gates.
