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
2. Helmet, CORS, compression and body parsers apply transport policies.
3. Swagger or versioned API routers handle the request.
4. Zod validates request/response data and supplies OpenAPI schemas.
5. Unknown routes and thrown errors pass through the central error middleware.
6. The response contains a request ID without exposing internal exceptions.

## Boundaries

- `config`: environment validation and stable application constants.
- `common`: reusable HTTP errors, middleware and schemas.
- `infrastructure`: PostgreSQL/Prisma, Apple identity-token verification,
  RoomScan token issuance and logging implementations.
- `modules`: product-facing route modules. Each module owns its schemas,
  router and OpenAPI registration.
- `openapi`: combines module registries into the public OpenAPI document.

Business modules should depend on small interfaces rather than importing the
global Prisma client directly. Runtime composition belongs in `server.ts`.

## Authentication

`POST /api/v1/auth/apple` accepts only an Apple identity token. The auth module
depends on interfaces for Apple verification, user persistence and application
token issuance. Infrastructure adapters verify RS256 tokens against Apple's
cached remote JWKS, atomically upsert users by `(provider, providerId)`, and
sign RoomScan access and refresh JWTs with separate secrets.

Apple `sub` is the stable external identifier. Email is nullable and is never
used to find or link a user. A supplied email updates the stored email and
verification state; an absent email leaves existing values unchanged.

The refresh JWT is issued for the mobile client but is not persisted or
consumed by an endpoint yet. Apple authorization-code exchange, nonce
validation, application refresh-token rotation and revocation are outside the
implemented scope.

## Persistence

The composition root creates one Prisma Client and injects it into the database
health/lifecycle adapter and the Apple user repository. Product modules never
import that client directly. The unique provider identity constraint makes
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
