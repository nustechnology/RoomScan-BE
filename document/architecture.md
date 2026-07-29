# Architecture

RoomScan Backend is a single Express service using native ECMAScript modules.
It starts from `src/server.ts`, while `src/app.ts` creates the HTTP application
from injected dependencies. Keeping `app.listen` outside the app factory makes
API tests deterministic and prevents them from opening network ports.

The current product-facing scope contains health checks, Apple Sign-In
authentication, and Owner/Viewer project management. The Prisma schema owns the
`User`, `Project`, and `ProjectAccess` models; Room, Scan, Invitation, Note, and
asset behavior must not be inferred until their requirements are implemented.

## Request flow

1. Pino HTTP attaches a request ID and structured request logger.
2. Helmet and CORS apply security and cross-origin policies.
3. A general IP rate limiter protects `/api/v1` before request bodies are
   parsed, excluding liveness and readiness. The Apple authentication
   limiter is mounted path-specifically at `/api/v1/auth/apple` at the
   same stage, also before body parsing, so every attempt on that path
   consumes the Apple quota regardless of parse outcome.
4. Compression and body parsers apply transport policies.
5. Swagger or versioned API routers handle the request.
6. Zod validates request/response data and supplies OpenAPI schemas.
7. Unknown routes and thrown errors pass through the central error middleware.
8. The response contains a request ID without exposing internal exceptions.

## Boundaries

- `config`: environment validation and stable application constants.
- `common`: reusable HTTP errors, middleware, rate-limit policies and schemas.
- `infrastructure`: PostgreSQL/Prisma, Apple identity-token verification,
  RoomScan token issuance and logging implementations.
- `modules`: product-facing route modules. Each module owns its schemas,
  router and OpenAPI registration.
- `openapi`: combines module registries into the public OpenAPI document.

Business modules should depend on small interfaces rather than importing the
global Prisma client directly. Runtime composition belongs in `server.ts`.

## Authentication

`POST /api/v1/auth/apple` normally accepts an Apple identity token. The auth
module depends on interfaces for Apple verification, user persistence and
application token issuance. Infrastructure adapters verify RS256 tokens against
Apple's cached remote JWKS, atomically upsert users by `(provider, providerId)`,
and sign RoomScan access and refresh JWTs with separate secrets.

An opt-in local development adapter recognizes the fixed
`roomscan-local-test-user` sentinel instead of calling Apple. Configuration
validation permits this adapter only when `NODE_ENV=development` and
`LOCAL_TEST_AUTH_ENABLED=true`; the composition root also requires both
conditions. The adapter returns the same provider identity created by
`yarn seed:local`, then the normal user repository and token issuer produce
real RoomScan access and refresh JWTs. All other tokens still use Apple
verification. Staging, test, production, and the production-style Compose API
cannot enable this shortcut.

Apple `sub` is the stable external identifier. Email is nullable and is never
used to find or link a user. A supplied email updates the stored email and
verification state; an absent email leaves existing values unchanged.

The refresh JWT is issued for the mobile client but is not persisted or
consumed by an endpoint yet. Application refresh-token rotation and revocation
are outside the implemented scope.

Apple authorization-code exchange is not implemented: outside the explicitly
enabled local sentinel, the endpoint accepts only Apple identity tokens, not
authorization codes.

### Access-token authentication

Project endpoints require a valid RoomScan access token. The
`AccessTokenVerifier` abstraction verifies HS256 signature, issuer, audience,
expiration, `tokenType: "access"`, and a UUID `sub` claim using the same issuer
and audience constants as the token issuer. The JOSE implementation
(`JoseAccessTokenVerifier`) shares the access-token secret with
`JoseAuthTokenIssuer`.

The `authenticate` middleware extracts the Bearer token from the
`Authorization` header, verifies it, loads the current database user, and stores
that user in `request.locals`. Missing, malformed, expired, refresh, or
otherwise invalid tokens—and valid tokens whose subject no longer exists—are
rejected with `401 UNAUTHORIZED`. Handlers read the authenticated user ID
through `getUserId(request)`.

## Project module

The Project module provides authenticated project creation, owned-project
listing and search, canonical detail, Owner-only updates, and soft deletion.
`ProjectPermissionService` authorizes detail for the Owner or an active Viewer;
only the Owner receives mutation capabilities. Missing, deleted, revoked, and
inaccessible resources all return `404 PROJECT_NOT_FOUND` to avoid
resource-existence disclosure.

The `ProjectRepository` interface isolates the service from Prisma.
`PrismaProjectRepository` performs case-insensitive name search, total counting,
allow-listed sorting, stable ID tie-breaking, and offset pagination. The
`@@index([ownerId, deletedAt, updatedAt, id])` index supports the default
active-owner listing ordered by latest activity.

Canonical project detail resolves the record and the caller's Owner or active
Viewer role in one repository lookup. An Owner update performs its guarded
write and response read in one transaction, so an overlapping deletion cannot
turn an already-applied update into a not-found response.

Deletion marks `Project.deletedAt` and revokes active `ProjectAccess` records in
one database transaction. A repeated deletion by the same Owner is idempotent.
Physical cleanup remains outside this module. Scan, Invitation, Note, thumbnail,
sync-state, and asset cleanup are not claimed here because their persistence
models are not yet present on this branch.

The owner relation uses `onDelete: Restrict` to prevent accidental project loss
when a user is deleted. Project names are not unique per owner.

### Nonce binding

The endpoint supports nonce binding to prevent identity-token replay. Clients
may generate a random nonce, include it in the Sign In with Apple authorization
request, receive it back in the identity token's `nonce` claim, and pass the
same nonce alongside the token in `POST /api/v1/auth/apple`.

When the client provides a nonce, `AppleIdentityTokenVerifier` requires the
token's `nonce` claim to match exactly. Missing or mismatched nonces are
rejected as `InvalidAppleIdentityTokenError`. When no nonce is provided, the
claim is not checked — allowing non-upgraded clients to authenticate, but
without replay protection.

## Rate limiting

The composition root creates independent general API and Apple authentication
rate limiters and injects them into the application factory. The general policy
allows 120 requests per 60 seconds for each client IP. Apple authentication has
an additional policy allowing 20 attempts per 15 minutes. Every Apple attempt
counts regardless of its outcome.

Liveness, readiness, Swagger and raw OpenAPI are exempt. Rejected requests use
the standard error middleware and return 429 with `RateLimit`,
`RateLimit-Policy`, `Retry-After` and `x-request-id` headers.

The current built-in MemoryStore is process-local: counters reset when the
process restarts and are not shared between replicas. Store errors fail open
and are logged because rate limiting is a defense-in-depth control, not a
required authentication dependency. A multi-replica deployment must replace
the stores with shared Redis-backed stores without changing module routes.

Client keys come from Express `request.ip`; IPv6 addresses are grouped by `/56`.
The application does not trust forwarding headers by default. Deployments
behind a reverse proxy must configure `TRUST_PROXY` to the exact hop count or
trusted IP/CIDR topology rather than trusting every proxy.

## Persistence

The composition root creates one Prisma Client and injects it into the database
health/lifecycle adapter, the Apple user repository, the current-user
repository, and the project repository. It also creates the two rate-limit
middleware instances, the access-token verifier, the project permission
service, and the project service once per process. Product modules never import
the Prisma client directly. The unique provider identity constraint makes
concurrent first-time Apple logins idempotent at the database boundary. The
projects table has a foreign key to users with `onDelete: Restrict`; project
access has unique `(projectId, userId)` membership and revocation state.

## Lifecycle

The server validates configuration before listening. SIGINT and SIGTERM close
the HTTP server and disconnect the shared Prisma Client. Uncaught exceptions
and rejected promises are logged internally and trigger the same shutdown
path.

## Architecture documentation triggers

Update this document in the same branch when a change affects:

- Application startup, shutdown, dependency composition, or configuration
  validation.
- Middleware order or any cross-cutting request/response behavior.
- Module ownership, boundaries, dependency direction, or shared abstractions.
- Database access patterns, Prisma integration, or persistence topology.
- The implemented product-module scope.

Architectural decisions that introduce a new pattern must explain why the
existing pattern is insufficient. Update the
[documentation index](README.md) if architecture guidance is split into a new
document.
