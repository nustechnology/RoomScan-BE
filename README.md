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
yarn prisma:migrate:deploy
# Optional: set LOCAL_TEST_AUTH_ENABLED=true in .env, then:
yarn seed:local
yarn dev
```

The API is available at <http://localhost:3000>. The application validates all
required environment variables before opening the HTTP port.

The committed Prisma migration creates the user storage required by Apple
authentication. Local production-style startup applies committed migrations
through the Compose `migrate` service.

The standard local workflow uses Docker only for the PostgreSQL `db` service.
Run migrations, seeds, the API, validation, tests, coverage and builds natively
with Yarn. Keep a healthy database container running across tasks rather than
restarting it during final verification.

## Optional production-style Docker stack

```bash
cp .env.example .env
docker compose up --build
```

Compose starts PostgreSQL and MinIO, runs `prisma migrate deploy` as a one-shot
service, then starts the non-root production API container. This is an optional
production-style check, not the normal local development or agent handoff
workflow.

The API container runs with `NODE_ENV=production`, so it fails closed when
`STORAGE_PROVIDER=local`: the startup validation rejects the default local
adapter. The stack starts MinIO and wires the API to it
(`STORAGE_PROVIDER=minio` by default), so the API container waits for a healthy
object store before starting. The MinIO service requires `MINIO_ROOT_USER` and
`MINIO_ROOT_PASSWORD` from `.env` (no fallback values), and publishes its API
and console ports on the loopback interface only. For the development flow that
uses the local adapter, run the API natively with `yarn dev`.

Useful commands:

```bash
docker compose ps
docker compose logs -f api
docker compose down
```

Use `docker compose down --volumes` only when you intentionally want to delete
the local PostgreSQL and MinIO data volumes.

## HTTP endpoints

| Method   | Path                                                   | Purpose                                                    |
| -------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| `GET`    | `/api/v1/health`                                       | Liveness; does not query PostgreSQL                        |
| `GET`    | `/api/v1/ready`                                        | Readiness; verifies PostgreSQL with `SELECT 1`             |
| `POST`   | `/api/v1/auth/apple`                                   | Authenticate with an Apple identity token                  |
| `POST`   | `/api/v1/auth/refresh`                                 | Rotate a RoomScan refresh token                            |
| `POST`   | `/api/v1/projects`                                     | Create a project (Bearer token required)                   |
| `GET`    | `/api/v1/projects`                                     | List the authenticated user’s projects                     |
| `GET`    | `/api/v1/projects/:projectId`                          | Get a project as Owner or active Viewer                    |
| `PATCH`  | `/api/v1/projects/:projectId`                          | Update an owned project                                    |
| `DELETE` | `/api/v1/projects/:projectId`                          | Soft-delete an owned project                               |
| `POST`   | `/api/v1/projects/:projectId/scans`                    | Create scan metadata (Owner only)                          |
| `GET`    | `/api/v1/projects/:projectId/scans`                    | List scans; Owner or active Viewer                         |
| `GET`    | `/api/v1/scans/:scanId`                                | Get scan detail; Owner or active Viewer                    |
| `PATCH`  | `/api/v1/scans/:scanId`                                | Update scan name/description (Owner only)                  |
| `DELETE` | `/api/v1/scans/:scanId`                                | Soft-delete a scan (Owner only)                            |
| `POST`   | `/api/v1/scans/:scanId/assets/upload-sessions`         | Create an upload session (Owner only)                      |
| `POST`   | `/api/v1/upload-sessions/:uploadSessionId/complete`    | Mark an upload completed (Owner only)                      |
| `GET`    | `/api/v1/scans/:scanId/assets`                         | List scan asset metadata; Owner or active Viewer           |
| `GET`    | `/api/v1/scans/:scanId/assets/:assetType/download-url` | Download URL; Owner or active Viewer                       |
| `POST`   | `/api/v1/upload-sessions/:uploadSessionId/fail`        | Report an upload failure (Owner only)                      |
| `POST`   | `/api/v1/scans/:scanId/notes`                          | Create a note on a scan (Owner only)                       |
| `GET`    | `/api/v1/scans/:scanId/notes`                          | List notes; Owner or active Viewer                         |
| `GET`    | `/api/v1/notes/:noteId`                                | Get note detail; Owner or active Viewer                    |
| `PATCH`  | `/api/v1/notes/:noteId`                                | Update note content or color (Owner only)                  |
| `PATCH`  | `/api/v1/notes/:noteId/position`                       | Move a note to a new 3D position (Owner only)              |
| `DELETE` | `/api/v1/notes/:noteId`                                | Delete a note (Owner only)                                 |
| `POST`   | `/api/v1/projects/:projectId/invitations`              | Create an invitation link (Owner only)                     |
| `GET`    | `/api/v1/invitations/:token`                           | Preview an invitation (anonymous or optional Bearer)       |
| `POST`   | `/api/v1/invitations/:token/accept`                    | Accept an invitation and gain Viewer access                |
| `POST`   | `/api/v1/invitations/:token/decline`                   | Decline an invitation                                      |
| `DELETE` | `/api/v1/invitations/:invitationId`                    | Revoke a pending invitation (Owner only)                   |
| `GET`    | `/api/v1/projects/:projectId/shares`                   | List pending invitations and accepted Viewers (Owner only) |
| `DELETE` | `/api/v1/projects/:projectId/shares/:userId`           | Revoke Viewer access (Owner only)                          |
| `GET`    | `/api-doc`                                             | Interactive Swagger UI                                     |
| `GET`    | `/api-doc.json`                                        | Generated OpenAPI 3.1 document                             |

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
  "identityToken": "<apple-identity-token>",
  "nonce": "<raw-client-nonce>"
}
```

The server verifies the token against Apple's public JWKS, identifies the user
by Apple `sub`, creates the user when necessary and returns RoomScan access and
refresh JWTs. Email is stored when present but is never an account identifier.
The companion `POST /api/v1/auth/refresh` endpoint rotates the refresh JWT and
issues a new access+refresh pair with stateful JTI tracking.

For local `yarn dev`, set `NODE_ENV=development` and
`LOCAL_TEST_AUTH_ENABLED=true`, then run `yarn seed:local`. Sending
`{"identityToken":"roomscan-local-test-user"}` to the same Apple endpoint skips
Apple verification for `local-test@roomscan.dev` and returns normally signed
RoomScan tokens. The seed also creates a demo project owned by that local user
with room scans spanning several asset and sync states and text notes anchored
to those scans, ready to list and inspect. The flag is rejected in test,
staging, and production; the production-style Compose API therefore cannot
expose this shortcut.

To obtain an access token for the Swagger UI `Authorize` dialog and local API
calls, request a token for the seeded local user and paste the returned
`accessToken`:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/apple \
  -H "Content-Type: application/json" \
  -d '{"identityToken":"roomscan-local-test-user"}' \
  | jq -r .accessToken) && echo "$TOKEN"
```

Project endpoints require a Bearer access token obtained from Apple
authentication or token refresh:

```http
Authorization: Bearer <access-token>
```

The server verifies the HS256 signature, issuer, audience, expiration,
`tokenType: "access"`, and UUID `sub` claim, then confirms that the subject
still identifies a database user. The `ownerId` is derived from that current
user and is never accepted from clients.

`GET /api/v1/projects` lists only projects owned by the current user. It uses
page-based pagination (`page=1`, `limit=5` by default), optional
case-insensitive name search, and an allow-listed `sort` parameter. An Owner
has full project control; an active Viewer can only use the canonical project
detail endpoint. Deleted, revoked, missing, and inaccessible projects are
hidden behind `404 PROJECT_NOT_FOUND`. Deletion is soft and idempotent for the
same Owner.

Scans are metadata records owned by a project. `POST` and `GET` at
`/api/v1/projects/:projectId/scans` create and list scans; `GET`, `PATCH`, and
`DELETE` at `/api/v1/scans/:scanId` read, rename, and soft-delete a scan. The
project Owner has full scan control; an active Viewer may only read scan list
and detail. Create accepts an optional `clientMutationId` for idempotency
(returning the existing active scan with `200` on a repeat). A scan name is
required (1–100 trimmed characters, not whitespace-only) and description is
optional (≤500). Scan deletion is soft and idempotent and touches the parent
project `updatedAt`. Missing, deleted, or inaccessible scans are hidden behind
`404 SCAN_NOT_FOUND`, and their parent project behind `404 PROJECT_NOT_FOUND`.
The metadata endpoints do not accept model files; `assetStatus` and `syncStatus`
start at `NONE` and `PENDING` respectively until the upload flow writes them.

Create Scan can also return presigned upload URLs in the same response: optional
`thumbnail` and `scanFile` descriptors (`contentType`, `sizeBytes`, and the
`checksum`/`modelVersion` required for the scan file) make the API mint an
upload session for each and return its `uploadUrl` under `uploads.thumbnail` /
`uploads.scanFile`. The client then uploads the files directly to those URLs and
marks each session complete.

Scan assets use minted URLs: the Owner creates an upload session
(`POST /api/v1/scans/:scanId/assets/upload-sessions`), the client uploads to the
returned URL, then marks it complete
(`POST /api/v1/upload-sessions/:uploadSessionId/complete`). Completion is
idempotent and marks the parent scan synced. A model scan file must be between
10 MB and 100 MB; a completed thumbnail upload persists a display URL onto the
scan so project and scan responses show it. Owner and active Viewers can list
metadata and request download URLs
(`GET /api/v1/scans/:scanId/assets/:assetType/download-url`); revoked Viewers
and deleted projects/scans are denied. The raw `storageKey` field is omitted
from API responses, although the local provider's URLs embed the object key
path.

Project list and detail responses include each project's active scans under
`scans`, with `id`, `name`, `description`, `thumbnail`, `noteCount`,
`assetStatus`, `syncStatus`, and `createdAt`; the `scanCount` field is the
number of active scans (the "N room scans" label).

Notes are text annotations anchored to 3D positions inside a scan model. `POST`
and `GET` at `/api/v1/scans/:scanId/notes` create and list notes; `GET`, `PATCH`,
and `DELETE` at `/api/v1/notes/:noteId` read, edit, and delete a note, and
`PATCH /api/v1/notes/:noteId/position` moves it. The project Owner creates,
edits, moves, and deletes notes; an active Viewer may only list and read them.
Content is required on create (1–2000
trimmed characters), color is a preset (`YELLOW`, `RED`, `BLUE`, `GREEN`,
`ORANGE`, `PURPLE`), position is a `{ x, y, z }` vector, and `modelVersion` must
match the scan's current model version (`409` otherwise). Note content is never
written to logs. Deleting a scan or project makes its notes inaccessible.

Projects are shared through expiring invitation links. The Owner creates a link
(`POST /api/v1/projects/:projectId/invitations`, optionally with
`expiresInSeconds`) only after the project has at least one scan with an
uploaded model, and receives an `invitationUrl` whose raw token is random and
never stored (only its SHA-256 hash is). Recipients can preview the link without
signing in, then accept to gain Viewer access or decline; the link remains
usable by other recipients until revoked or expired. The Owner can list pending
links and active Viewers (`GET /api/v1/projects/:projectId/shares`), revoke a
pending link, and revoke a Viewer's access
(`DELETE /api/v1/projects/:projectId/shares/:userId`). Revoked Viewers lose
project, scan, note, and asset-download access immediately. Share management is
Owner-only (`403 NOT_OWNER` for others).

For nonce-bound sign-in, the client generates a raw nonce, sends its lowercase
hexadecimal SHA-256 digest to Apple, and sends the raw nonce in the request
above. If the identity token contains a `nonce` claim, the raw request nonce is
required and its digest must match. Legacy tokens without a nonce claim remain
valid only when the request also omits `nonce`.

API requests are limited by client IP. `/api/v1` permits 120 requests per
minute, Apple sign-in additionally permits 20 attempts per 15 minutes, and
token refresh additionally permits 10 attempts per 15 minutes.
Health, readiness, Swagger and raw OpenAPI are exempt. Exceeded quotas return
429 with `RATE_LIMIT_EXCEEDED`, `RateLimit`, `RateLimit-Policy`, `Retry-After`
and `x-request-id`.

## Environment variables

| Variable                                                 | Required | Default                 | Description                                                         |
| -------------------------------------------------------- | -------- | ----------------------- | ------------------------------------------------------------------- |
| `NODE_ENV`                                               | No       | `development`           | `development`, `staging`, `test` or `production`                    |
| `PORT`                                                   | No       | `3000`                  | HTTP port inside the process                                        |
| `DATABASE_URL`                                           | Yes      | —                       | PostgreSQL connection string                                        |
| `LOG_LEVEL`                                              | No       | `info`                  | Pino log level                                                      |
| `CORS_ORIGIN`                                            | No       | `*`                     | `*` or comma-separated allowed origins                              |
| `TRUST_PROXY`                                            | No       | disabled                | Trusted hop count or comma-separated proxy IPs/CIDRs                |
| `RATE_LIMIT_API_WINDOW_SECONDS`                          | No       | `60`                    | General API rate-limit window                                       |
| `RATE_LIMIT_API_MAX_REQUESTS`                            | No       | `120`                   | Requests per IP in the general API window                           |
| `RATE_LIMIT_APPLE_AUTH_WINDOW_SECONDS`                   | No       | `900`                   | Apple sign-in rate-limit window                                     |
| `RATE_LIMIT_APPLE_AUTH_MAX_REQUESTS`                     | No       | `20`                    | Apple sign-in attempts per IP in its window                         |
| `RATE_LIMIT_REFRESH_AUTH_WINDOW_SECONDS`                 | No       | `900`                   | Token refresh rate-limit window                                     |
| `RATE_LIMIT_REFRESH_AUTH_MAX_REQUESTS`                   | No       | `10`                    | Token refresh attempts per IP in its window                         |
| `APPLE_CLIENT_ID`                                        | Yes      | —                       | Native app bundle identifier used as Apple `aud`                    |
| `AUTH_ACCESS_TOKEN_SECRET`                               | Yes      | —                       | HS256 access-token secret, at least 32 characters                   |
| `AUTH_REFRESH_TOKEN_SECRET`                              | Yes      | —                       | HS256 refresh-token secret, at least 32 characters                  |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS`                          | No       | `3600`                  | RoomScan access-token lifetime                                      |
| `AUTH_REFRESH_TOKEN_TTL_SECONDS`                         | No       | `2592000`               | RoomScan refresh-token lifetime                                     |
| `LOCAL_TEST_AUTH_ENABLED`                                | No       | `false`                 | Enable the seeded login only in `development`                       |
| `STORAGE_PROVIDER`                                       | No       | `local`                 | Storage adapter: `local` (dev/test fake) or `minio` (S3-compatible) |
| `STORAGE_BUCKET` / `STORAGE_REGION` / `STORAGE_ENDPOINT` | No       | ``                      | MinIO bucket, region, and `host[:port]` endpoint                    |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY`    | No       | ``                      | MinIO credentials; required with `STORAGE_PROVIDER=minio`           |
| `STORAGE_USE_SSL`                                        | No       | `false`                 | Use HTTPS instead of HTTP for the MinIO endpoint                    |
| `STORAGE_UPLOAD_URL_TTL_SECONDS`                         | No       | `900`                   | Signed upload URL lifetime                                          |
| `STORAGE_DOWNLOAD_URL_TTL_SECONDS`                       | No       | `60`                    | Signed download URL lifetime                                        |
| `ASSET_MIN_MODEL_SIZE_BYTES`                             | No       | `10000000`              | Minimum model scan-file size (10 MB)                                |
| `ASSET_MAX_MODEL_SIZE_BYTES`                             | No       | `100000000`             | Maximum model scan-file size (100 MB)                               |
| `ASSET_MAX_THUMBNAIL_SIZE_BYTES`                         | No       | `10000000`              | Maximum thumbnail asset size                                        |
| `INVITATION_TTL_SECONDS`                                 | No       | `604800`                | Default invitation-link lifetime (7 days)                           |
| `INVITATION_BASE_URL`                                    | No       | `http://localhost:3000` | Client-facing base used to build `invitationUrl` links              |

The remaining PostgreSQL, MinIO and `ROOMSCAN_PORT` values in `.env.example`
configure Docker Compose. The refresh TTL must exceed the access TTL. Replace
all authentication placeholders before deployment; never commit `.env` or real
credentials.

The default `STORAGE_PROVIDER=local` uses an unsigned in-process adapter for
development and tests; it mints URLs whose TTL is metadata only (not encoded or
enforced), does not persist uploaded bytes, and always accepts completion.
`STORAGE_PROVIDER=minio` selects the S3-compatible MinIO adapter, which lazily
creates the configured bucket, mints presigned upload/download URLs enforced by
MinIO, and before completion verifies that the uploaded object's size and
content type exactly match the values declared when the upload session was
created. Startup fails closed: `NODE_ENV=production` rejects
`STORAGE_PROVIDER=local`, and `STORAGE_PROVIDER` must be `minio` with the
bucket, endpoint, and credentials set.

Rate-limit counters are stored in the API process, reset on restart and are not
shared by replicas. The current single-instance Compose topology needs no
additional store. Before deploying behind a reverse proxy, set `TRUST_PROXY` to
the exact proxy hop count or trusted IP/CIDR list. Never set it to `true`.

## Project scripts

| Command                             | Description                                                              |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `yarn dev`                          | Run the API with TSX watch mode                                          |
| `yarn build`                        | Generate Prisma Client and compile production JavaScript                 |
| `yarn start`                        | Run the compiled API                                                     |
| `yarn lint` / `yarn lint:fix`       | Check or fix lint errors                                                 |
| `yarn format` / `yarn format:check` | Write or verify Prettier formatting                                      |
| `yarn typecheck`                    | Run strict TypeScript checks without emitting                            |
| `yarn test`                         | Run Vitest in watch mode                                                 |
| `yarn test:run`                     | Run unit/API tests once                                                  |
| `yarn test:coverage`                | Run tests and enforce coverage thresholds                                |
| `yarn validate`                     | Run the complete local pre-commit quality gate                           |
| `yarn prisma:generate`              | Regenerate the ignored Prisma Client                                     |
| `yarn prisma:migrate:dev`           | Create/apply a development migration                                     |
| `yarn prisma:migrate:deploy`        | Apply committed migrations                                               |
| `yarn prisma:studio`                | Open Prisma Studio                                                       |
| `yarn seed:local`                   | Create or refresh the development-only login user and demo project/scans |

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

For routine task handoff, agents run `yarn validate`, `yarn test:coverage` and
`yarn build` natively. They do not rebuild or start the full Compose stack and
do not restart a healthy PostgreSQL container. Targeted Docker verification is
reserved for explicit requests or acceptance criteria about container
behavior.

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
- If all clients share one rate-limit bucket, verify `TRUST_PROXY` against the
  actual reverse-proxy topology. A wrong value can also allow clients to spoof
  their source IP.
- If legitimate users receive 429 behind a shared carrier or office IP, tune
  the `RATE_LIMIT_*` values and inspect structured 429 logs.
- If port 5432 is already in use, stop the other PostgreSQL service or adjust
  the database port mapping and connection URL together.
- If Git hooks are absent after cloning, run `yarn install` or `yarn prepare`.
