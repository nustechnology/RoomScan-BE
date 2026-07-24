# RoomScan Backend

Production-ready backend foundation for RoomScan, built with Node.js, Express,
TypeScript, Prisma and PostgreSQL.

## Technology baseline

- Node.js 24 LTS
- Yarn 4 through Corepack
- Express 5 with TypeScript 5.9 and native ESM
- Prisma ORM 7 with the PostgreSQL driver adapter
- PostgreSQL 18
- Zod-based request validation and OpenAPI 3.1 generation
- Vitest, Supertest and V8 coverage
- ESLint 10, typescript-eslint and Prettier
- Husky pre-commit quality gate
- Docker multi-stage build and Docker Compose

## Prerequisites

For local development:

- Node.js 24 (`.nvmrc` pins the preferred patch version)
- Corepack
- Docker with Docker Compose, or another reachable PostgreSQL instance

The project uses Yarn's `node-modules` linker for broad compatibility with
Prisma, Husky, editors and container builds.

## Local setup

```bash
nvm install
nvm use
corepack enable
corepack install
cp .env.example .env
# Replace APPLE_CLIENT_ID and both AUTH_*_TOKEN_SECRET placeholders.
yarn install --immutable
yarn prisma:generate
docker compose up db -d
yarn dev
```

The API is available at <http://localhost:3000>. The application validates all
required environment variables before opening the HTTP port.

The committed Prisma migration creates the user storage required by Apple
authentication. Local production-style startup applies committed migrations
through the Compose `migrate` service.

## Run everything with Docker

```bash
cp .env.example .env
docker compose up --build
```

Compose starts PostgreSQL, runs `prisma migrate deploy` as a one-shot service,
then starts the non-root production API container.

Useful commands:

```bash
docker compose ps
docker compose logs -f api
docker compose down
```

Use `docker compose down --volumes` only when you intentionally want to delete
the local PostgreSQL data volume.

## HTTP endpoints

| Method | Path                 | Purpose                                        |
| ------ | -------------------- | ---------------------------------------------- |
| `GET`  | `/api/v1/health`     | Liveness; does not query PostgreSQL            |
| `GET`  | `/api/v1/ready`      | Readiness; verifies PostgreSQL with `SELECT 1` |
| `POST` | `/api/v1/auth/apple` | Authenticate with an Apple identity token      |
| `GET`  | `/api-doc`           | Interactive Swagger UI                         |
| `GET`  | `/api-doc.json`      | Generated OpenAPI 3.1 document                 |

Errors use a stable envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": []
  },
  "requestId": "a-request-id"
}
```

Clients may send `x-request-id`; otherwise the API generates one and returns it
in the response header.

Apple authentication accepts:

```json
{
  "identityToken": "<apple-identity-token>"
}
```

The server verifies the token against Apple's public JWKS, identifies the user
by Apple `sub`, creates the user when necessary and returns RoomScan access and
refresh JWTs. Email is stored when present but is never an account identifier.
The current API issues the refresh JWT but does not yet expose refresh, rotation
or revocation endpoints.

## Environment variables

| Variable                         | Required | Default       | Description                                        |
| -------------------------------- | -------- | ------------- | -------------------------------------------------- |
| `NODE_ENV`                       | No       | `development` | `development`, `test` or `production`              |
| `PORT`                           | No       | `3000`        | HTTP port inside the process                       |
| `DATABASE_URL`                   | Yes      | —             | PostgreSQL connection string                       |
| `LOG_LEVEL`                      | No       | `info`        | Pino log level                                     |
| `CORS_ORIGIN`                    | No       | `*`           | `*` or comma-separated allowed origins             |
| `APPLE_CLIENT_ID`                | Yes      | —             | Native app bundle identifier used as Apple `aud`   |
| `AUTH_ACCESS_TOKEN_SECRET`       | Yes      | —             | HS256 access-token secret, at least 32 characters  |
| `AUTH_REFRESH_TOKEN_SECRET`      | Yes      | —             | HS256 refresh-token secret, at least 32 characters |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS`  | No       | `900`         | RoomScan access-token lifetime                     |
| `AUTH_REFRESH_TOKEN_TTL_SECONDS` | No       | `2592000`     | RoomScan refresh-token lifetime                    |

The remaining PostgreSQL and `ROOMSCAN_PORT` values in `.env.example` configure
Docker Compose. The refresh TTL must exceed the access TTL. Replace all
authentication placeholders before deployment; never commit `.env` or real
credentials.

## Project scripts

| Command                             | Description                                              |
| ----------------------------------- | -------------------------------------------------------- |
| `yarn dev`                          | Run the API with TSX watch mode                          |
| `yarn build`                        | Generate Prisma Client and compile production JavaScript |
| `yarn start`                        | Run the compiled API                                     |
| `yarn lint` / `yarn lint:fix`       | Check or fix lint errors                                 |
| `yarn format` / `yarn format:check` | Write or verify Prettier formatting                      |
| `yarn typecheck`                    | Run strict TypeScript checks without emitting            |
| `yarn test`                         | Run Vitest in watch mode                                 |
| `yarn test:run`                     | Run unit/API tests once                                  |
| `yarn test:coverage`                | Run tests and enforce coverage thresholds                |
| `yarn validate`                     | Run the complete local pre-commit quality gate           |
| `yarn prisma:generate`              | Regenerate the ignored Prisma Client                     |
| `yarn prisma:migrate:dev`           | Create/apply a development migration                     |
| `yarn prisma:migrate:deploy`        | Apply committed migrations                               |
| `yarn prisma:studio`                | Open Prisma Studio                                       |

## Quality gates

The Husky pre-commit hook runs `corepack yarn validate`, so commits from Git
GUIs cannot accidentally use a globally installed Yarn 1. It requires the
`corepack` executable from Node.js 24 to be available on the Git process
`PATH`. The quality gate requires:

1. Prettier check
2. ESLint
3. TypeScript check
4. Unit/API tests

GitHub Actions repeats those checks using an immutable Yarn install, adds
coverage enforcement, and builds the production output. Unit tests inject
database, Apple JWKS and authentication doubles and do not require a live
PostgreSQL instance or Apple network access.

## Architecture and contributor guidance

- [Documentation entrypoint](document/README.md)
- [Documentation governance](document/documentation-governance.md)
- [Architecture](document/architecture.md)
- [API conventions](document/api-conventions.md)
- [Development workflow](document/development.md)
- [AI agent instructions](AGENTS.md)

Every contributor and AI agent must start with the documentation entrypoint.
Repository changes must keep the affected documentation current on the same
branch before handoff or merge.

The Prisma Client under `src/generated/prisma` and the local `.codegraph` index
are generated artifacts and are intentionally not committed.

## Troubleshooting

- If the wrong Yarn version runs, execute `corepack enable && corepack install`
  and confirm `yarn --version` reports `4.17.1`.
- If a Git GUI cannot find Corepack, start the GUI from a Node 24-enabled
  terminal or configure its environment so `node` and `corepack` are on
  `PATH`.
- If Prisma types are missing, run `yarn prisma:generate`.
- If readiness returns 503, check `DATABASE_URL` and `docker compose ps`.
- If port 5432 is already in use, stop the other PostgreSQL service or adjust
  the database port mapping and connection URL together.
- If Git hooks are absent after cloning, run `yarn install` or `yarn prepare`.
