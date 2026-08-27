# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Mandatory: read before working

This repo enforces a documentation-first workflow for every agent, defined in
`AGENT.md` and `AGENTS.md` (not auto-loaded like this file — read them
explicitly). In short:

1. Read `document/README.md`, then `document/documentation-governance.md`,
   then the task-mapped documents (`document/architecture.md`,
   `document/api-conventions.md`, `document/development.md`) before touching
   implementation.
2. Every change that touches repository files must update the affected
   documentation **on the same branch** — never deferred. If no documented
   fact changed, say which documents you checked and why nothing needed
   updating.
3. Treat `document/` as the current contract for the checked-out branch;
   `/api-doc.json` is the machine-readable HTTP contract generated from the
   same Zod schemas used at runtime. A mismatch between docs, code, tests, and
   OpenAPI is a defect to fix in the same task, not to ignore.
4. For code review / code quality / merge-readiness tasks, follow
   `.agents/skills/code-review-and-quality/SKILL.md` (read-only unless fixes
   are explicitly requested).
5. Prefer CodeGraph for symbol/caller/callee/impact questions; run
   `codegraph init -i` if `.codegraph` is missing.

## Commands

```bash
yarn dev                       # run API with tsx watch
yarn build                     # prisma generate + tsc production build
yarn typecheck                 # tsc --noEmit
yarn lint / yarn lint:fix
yarn format / yarn format:check
yarn test                      # vitest watch mode
yarn test:run                  # vitest run once
yarn test:run test/scan.service.test.ts            # single file
yarn test:run -t "revoked"                          # filter by test name
yarn test:coverage             # vitest run --coverage (80% branches/functions/lines/statements gate)
yarn validate                  # format:check && lint && typecheck && test:run — the full local gate
yarn prisma:generate           # regenerate the gitignored Prisma Client (src/generated/prisma)
yarn prisma:migrate:dev        # create/apply a dev migration
yarn prisma:migrate:deploy     # apply committed migrations
yarn prisma:migrate:reset      # destructive; development only, confirm with the user first
yarn seed:local                # seeded local-test-auth user + demo projects/scans
```

Before handing work back, run `yarn validate`, `yarn test:coverage`, and
`yarn build` natively. Docker is used only for the local PostgreSQL (and
optional MinIO) service via `docker-compose.local.yml`
(`docker compose -f docker-compose.local.yml up db -d` if not already
running) — do not rebuild, restart, or bring up the full Compose stack as a
routine verification step; `docker-compose.yml` is the separate
production-style stack. `prisma migrate reset` and other destructive DB
operations require explicit user confirmation — the CLI itself blocks running
them unattended as an AI agent.

## Architecture

Single Express 5 service, native ESM, Node 24 / Yarn 4. `src/server.ts` wires
concrete infrastructure into an `AppDependencies` object and calls
`app.listen`; `src/app.ts` is a pure factory that builds the Express app from
that injected dependency bag (`createApp(deps)`). Keeping `listen` out of the
factory keeps API tests deterministic (supertest against an app that never
opens a port). Business modules depend on narrow interfaces, not the Prisma
client directly — inject infrastructure, don't import it into `modules/`.

Layout:

- `src/config` — environment validation (fails closed on missing/invalid vars) and constants.
- `src/common` — `AppError` + standard error envelope, middleware (auth, rate limit, error handler), idempotency helpers, revision/`If-Match` helpers, shared Zod schemas.
- `src/infrastructure` — Prisma/PostgreSQL, Apple identity-token verification, JWT issuance, storage (local fake vs MinIO/S3), mail (log fake vs SMTP), logging.
- `src/modules/*` — one directory per product surface (`auth`, `project`, `scan`, `scan-asset`, `note`, `share`, `shared-projects`, `shared-scans`, `sync`, `health`, `well-known`); each owns its router, Zod schemas, service, and OpenAPI registration.
- `src/openapi` — combines module registries into the public OpenAPI 3.1 document served at `/api-doc.json`.
- `src/generated/prisma` — generated Prisma Client; never hand-edit or commit.

Request pipeline (in order): Pino request ID/logger → Helmet/CORS → general
`/api/v1` IP rate limiter (mounted before body parsing, plus path-specific
limiters on `/api/v1/auth/apple` and `/api/v1/auth/refresh`) → compression/body
parsers → Swagger/versioned routers → Zod validation → central error
middleware. `/.well-known/apple-app-site-association` is served at the host
root outside `/api/v1`, unauthenticated and rate-limit-exempt.

**Errors**: expected failures throw `AppError` subclasses (`statusCode` +
stable `code`) caught by the central error handler into the envelope
`{ error: { code, message, details }, requestId }`. Never leak Prisma/SQL
details or stack traces in responses. Owner/Viewer/not-found ambiguity is
intentional: missing, deleted, revoked, and inaccessible resources all
collapse to the same `404 ..._NOT_FOUND` to avoid existence disclosure.

**Auth**: Apple identity-token sign-in issues RoomScan HS256 access/refresh
JWTs (separate secrets); refresh rotation is stateful via a `RefreshToken.jti`
row, reuse is rejected. `authenticate` middleware verifies the Bearer token
and stores the current user on `request.locals` (read via `getUserId`).
`optionalAuthenticate` never rejects, for anonymous-plus-optional-context
endpoints like invitation preview. An opt-in local sentinel
(`roomscan-local-test-user`) bypasses Apple only when both
`NODE_ENV=development` and `LOCAL_TEST_AUTH_ENABLED=true`.

**Access model**: `Project`/`Scan` are Owner-controlled; sharing grants
read-only Viewer access via per-recipient `Invitation` rows or reusable
`ShareLink` rows, materialized into `ProjectAccess` / `ScanAccess` rows.
Each access row has two independent lifecycle timestamps:
`revokedAt` (Owner-only revoke path) and `deletedAt` (Viewer's own
self-removal from their Shared With Me list — added by the
`add_access_viewer_removal` migration and its four
`*_status_idx_concurrently` follow-ups, which each contain exactly one
`CREATE`/`DROP INDEX CONCURRENTLY` statement so Prisma Migrate doesn't wrap
them in a blocking transaction). Every permission check and every
Shared-With-Me list/detail query filters on both columns being unset; the two
lifecycles must not be conflated. `ProjectAccess` carries a `revision` column
used for optimistic-concurrency compare-and-set on Owner revoke vs Viewer
self-removal races; `ScanAccess` does not, and scan-level sharing is
intentionally outside the sync/change-feed system (`SyncResourceType` has no
`SCAN_ACCESS` value) — it's a simpler, non-offline-sync-integrated surface by
design, mirrored from the project-level one at scan granularity.

**Idempotency & concurrency**: Project/Scan/Note/Upload-Session/Invitation
POSTs require `Idempotency-Key`; the server stores a scoped key hash plus an
encrypted original response (`AES-256-GCM`, keys HKDF-derived from
`SYNC_CRYPTO_KEY`) and replays it for same-key/same-payload retries, `409`s on
a same-key different-payload retry. Project/Scan/Note detail responses expose
`revision` + `ETag: "N"`; Owner PATCH/DELETE requires matching `If-Match` and
`409 REVISION_CONFLICT`s on a stale write. Delete always wins over a stale
update.

**Sync**: `GET /api/v1/sync/changes` / `/sync/status` expose an append-only
`SyncChange` event log (`resourceType` × `resourceId`, revision, visibility
scope, optional target user) for offline-first mobile clients, covering
`PROJECT`, `SCAN`, `NOTE`, `SCAN_ASSET`, and `PROJECT_ACCESS` only. Writers to
this feed live in `src/infrastructure/database/prisma-sync-writer.ts`
(`writeAccessUpsert`, `writeDeleteChange`, etc.) and must run inside the same
Prisma transaction as the domain write they describe.

**Testing**: Vitest with Prisma delegate doubles (hand-rolled mocked
`PrismaClient` slices per repository, including a `$transaction` mock that
either runs an array of promises or invokes the passed callback with a
mock transaction client) — no live PostgreSQL needed for `test:run`. Native
migration/endpoint verification against the real `db` container is a separate,
explicit step, not part of routine unit testing. Coverage threshold is 80%
across branches/functions/lines/statements (`vitest.config.ts`), excluding
`src/config`, `src/generated`, `src/infrastructure/database/prisma.ts`,
`src/server.ts`, and `src/jobs/run-*.ts` (the cleanup-job CLI entrypoints,
which are thin composition-root scripts like `src/server.ts`; their logic
lives in the tested `src/jobs/*.job.ts` pure functions).

## Prisma rules

- Change data structures through `prisma/schema.prisma` plus a reviewed
  migration under `prisma/migrations/`; never hand-edit or commit
  `src/generated/prisma`.
- Never create or rewrite a production migration without explicit
  authorization, and never rewrite an already-applied migration.
- `CREATE`/`DROP INDEX CONCURRENTLY` cannot run inside a transaction block;
  Prisma Migrate applies a multi-statement `migration.sql` as one implicit
  transaction, so any concurrent index statement must be the sole statement
  in its own migration folder.

## Repository hygiene

Yarn only (no npm/pnpm lockfiles). Don't commit `.env`, generated output
(`dist`, `src/generated`, `coverage`), or `.codegraph`. Keep `yarn.lock`
changes atomic with deliberate dependency bumps.
