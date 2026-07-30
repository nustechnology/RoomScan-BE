# Architecture

RoomScan Backend is a single Express service using native ECMAScript modules.
It starts from `src/server.ts`, while `src/app.ts` creates the HTTP application
from injected dependencies. Keeping `app.listen` outside the app factory makes
API tests deterministic and prevents them from opening network ports.

The current product-facing scope contains health checks and Apple Sign-In
authentication. The Prisma schema owns the `User` model used by authentication;
Room and Scan behavior must not be inferred until their requirements are
defined.

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

`POST /api/v1/auth/apple` accepts an Apple identity token and an optional raw nonce.
Nonce-bound tokens require the raw nonce so the verifier can validate the binding.
The auth module
depends on interfaces for Apple verification, user persistence and application
token issuance. Infrastructure adapters verify RS256 tokens against Apple's
cached remote JWKS, atomically upsert users by `(provider, providerId)`, and
sign RoomScan access and refresh JWTs with separate secrets.

Apple `sub` is the stable external identifier. Email is nullable and is never
used to find or link a user. A supplied email updates the stored email and
verification state; an absent email leaves existing values unchanged.

The refresh JWT is issued for the mobile client but is not persisted or
consumed by an endpoint yet. Application refresh-token rotation and revocation
are outside the implemented scope.

Apple authorization-code exchange is not implemented: the endpoint accepts only
Apple identity tokens, not authorization codes.

### Nonce binding

The endpoint supports nonce binding to prevent identity-token replay. Clients
generate a random raw nonce, send its lowercase hexadecimal SHA-256 digest in
the Sign in with Apple authorization request, and pass the raw nonce alongside
the resulting identity token in `POST /api/v1/auth/apple`.

After cryptographically verifying the token, `AppleIdentityTokenVerifier`
hashes the supplied raw nonce and requires the digest to match the token's
`nonce` claim. A token containing a nonce claim requires a request nonce, and a
request nonce requires a token claim. Missing or mismatched bindings are
rejected as `InvalidAppleIdentityTokenError`. Legacy tokens without a nonce
claim remain accepted only when the request also omits the nonce.

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
health/lifecycle adapter and the Apple user repository. It also creates the two
rate-limit middleware instances once per process. Product modules never import
the Prisma client directly. The unique provider identity constraint makes
concurrent first-time Apple logins idempotent at the database boundary.

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
