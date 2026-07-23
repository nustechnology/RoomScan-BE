# Architecture

RoomScan Backend is a single Express service using native ECMAScript modules.
It starts from `src/server.ts`, while `src/app.ts` creates the HTTP application
from injected dependencies. Keeping `app.listen` outside the app factory makes
API tests deterministic and prevents them from opening network ports.

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
- `infrastructure`: PostgreSQL/Prisma and logging implementations.
- `modules`: product-facing route modules. Each module owns its schemas,
  router and OpenAPI registration.
- `openapi`: combines module registries into the public OpenAPI document.

Business modules should depend on small interfaces rather than importing the
global Prisma client directly. Runtime composition belongs in `server.ts`.

## Lifecycle

The server validates configuration before listening. SIGINT and SIGTERM close
the HTTP server and disconnect Prisma. Uncaught exceptions and rejected
promises are logged internally and trigger the same shutdown path.
