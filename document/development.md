# Development workflow

## Mandatory task loop

For every implementation, bug fix, refactor, dependency update, infrastructure
change, test change, review, or documentation task:

1. Read [the documentation index](README.md) before inspecting or changing
   implementation.
2. Read [Documentation governance](documentation-governance.md) and every
   task-specific document selected by the index.
3. Identify the intended behavior, affected boundaries, verification plan, and
   documentation impact.
4. Make implementation, tests, OpenAPI, configuration, and documentation
   changes together on the same branch.
5. After the final code diff, synchronize the affected documentation again.
6. Run the required quality gates.
7. Include a documentation-impact statement and verification results in the
   handoff.

Bug fixes must preserve the intended contract in documentation and add
regression protection. Do not document an accidental implementation defect as
the new contract merely to make code and documentation agree.

## Local setup

1. Use Node 24 and the Yarn version in `packageManager`.
2. Copy `.env.example` to `.env`.
3. Replace the Apple client ID and authentication-secret placeholders. Each
   token secret must contain at least 32 characters. Set `SYNC_CRYPTO_KEY` to a
   base64 encoding of exactly 32 random bytes and keep it stable for stored
   idempotency receipts and cursors.
4. Run `yarn install --immutable` and `yarn prisma:generate`.
5. Start the local infrastructure with
   `docker compose -f docker-compose.local.yml up -d --build` when it is not
   already running and healthy; leave an existing healthy container running.
6. Run `yarn prisma:migrate:deploy` to apply the committed schema migration.
7. To use the local Apple-login shortcut, set
   `LOCAL_TEST_AUTH_ENABLED=true`, run `yarn seed:local`, and start the API with
   `yarn dev`.

Docker supplies PostgreSQL (and optionally MinIO) in the standard local
workflow. `docker-compose.local.yml` holds the local-only services (the
PostgreSQL `db` container and the MinIO `minio` container); the production
`docker-compose.yml` stores the production `migrate`/`roomscan` API config and
is not used for local development. The default `STORAGE_PROVIDER=local` needs no
extra service, so MinIO is not part of the routine setup. To exercise the real
presigned-URL provider instead, run
`docker compose -f docker-compose.local.yml up minio -d` (the MinIO service
requires `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` from `.env`; its API and
console ports publish on the loopback interface), set
`STORAGE_PROVIDER=minio` with the matching `STORAGE_BUCKET`,
`STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY_ID` and `STORAGE_SECRET_ACCESS_KEY`
values from `.env.example`, and start the API. Run Prisma commands, seeds, the
API, validation, tests, coverage and builds natively with Yarn. If the `db`
service is already healthy, leave it running across tasks; do not restart or
recreate it as part of final verification.

### Public bucket access for thumbnails

Scan thumbnail display URLs are stable, unsigned object URLs, so the MinIO
bucket (or its objects) must be publicly readable — or fronted by a CDN/reverse
proxy — before thumbnails render in project and scan responses. Otherwise the
browser gets an S3 `AccessDenied` error. With the MinIO Client (`mc`, the
standalone binary from `dl.min.io`, not the Midnight Commander apt package),
grant anonymous download access once:

```bash
mc alias set rslocal http://localhost:9000 <MINIO_ROOT_USER> <MINIO_ROOT_PASSWORD>
mc anonymous set download rslocal/<STORAGE_BUCKET>
mc anonymous get rslocal/<STORAGE_BUCKET>
```

`<MINIO_ROOT_USER>` and `<MINIO_ROOT_PASSWORD>` are the values from `.env`
(see `.env.example`), the alias name is arbitrary, and `<STORAGE_BUCKET>`
defaults to `roomscan-assets`. `anonymous set download` grants unauthenticated
`GetObject` to everyone, which is exactly what the thumbnail display URL needs.
Anonymous reads apply to the whole bucket, so prefer a CDN/reverse proxy in
front of MinIO when the bucket holds non-public data, and use a stable public
`STORAGE_ENDPOINT` (never a local tunnel host) so persisted thumbnail URLs
remain reachable. If `STORAGE_ENDPOINT` itself can't be reachable by upload
clients (for example it's a Docker-internal hostname such as `minio:9000`,
resolvable only by the API container), set `STORAGE_PUBLIC_ENDPOINT` (and
`STORAGE_PUBLIC_USE_SSL` if needed) to the externally-reachable hostname
instead — presigned PUT/GET URLs are then signed against that endpoint while
internal bucket/stat calls keep using `STORAGE_ENDPOINT`, so the API process
itself never needs to route out to its own public endpoint.

The local seed is idempotent and refuses to run unless
`NODE_ENV=development`. It creates (or refreshes) the fixed local Apple user,
then seeds three demo projects owned by that user, each with room scans that
exercise a range of persisted MODEL asset and sync states, plus text notes anchored to the
primary project's scans, so the list, pagination, sort, and detail screens can
be tried without manual setup. The seed also emits initial sync bootstrap
changes, so `/sync/changes` and `/sync/status` are immediately demoable. It
also seeds four shared projects
the local user accepted (or was granted) as a Viewer — "Garden House"
(`ACTIVE`), "Maple Cottage" (`REVOKED`), "Willow Townhouse"
(`PROJECT_DELETED`), and "Cedar Bungalow" (`TEMPORARILY_UNAVAILABLE`) — so the
Shared With Me list exercises every status and the viewer-removal flow is
demoable locally. It also seeds a couple of scan-level Viewers for the local
user — "Garden Studio" (`ACTIVE`) and "Cottage Living Room" (`REVOKED`) — so the
Shared Scans surface is demoable locally too. With the shortcut enabled, use:

```json
{
  "identityToken": "roomscan-local-test-user"
}
```

at `POST /api/v1/auth/apple`. The response contains normally signed RoomScan
access and refresh JWTs for `local-test@roomscan.dev`. A second sentinel maps to
the seeded pending-invitation recipient so the accept flow is testable locally:

```json
{
  "identityToken": "roomscan-local-pending-invite-user"
}
```

This returns JWTs for `pending-invite@roomscan.dev`, the recipient of the
seed's demo invitation, so `POST /invitations/{token}/accept` can be exercised
with the printed `invitationUrl` instead of as the owner. Other identity tokens
continue through Apple verification. The production-style Compose API sets
`NODE_ENV=production`, so it never enables this shortcut and it also rejects
`STORAGE_PROVIDER=local`; the Compose stack starts MinIO and wires the API to it
(`STORAGE_PROVIDER=minio` by default), so the API container starts only once the
object store is healthy.

The default development rate limits use the in-process MemoryStore and require
no additional service. `TRUST_PROXY` remains empty for direct local and Compose
connections. Set it only when requests arrive exclusively through a known
reverse-proxy topology.

The `postman/` directory holds the operator-facing API test collection
(`RoomScan - Staging.postman_collection.json`) and its environments
(`RoomScan - Staging.postman_environment.json` for the deployed API and
`RoomScan - Local.postman_environment.json` for the locally seeded API). Keep
them in sync with the public HTTP surface: whenever a public route, request
field, or response shape changes, add or update the matching request in the
collection on the same branch. The collection description documents setup, the
sequential upload flow, the project and scan invitation sharing flow (including
the `409` states and token rotation), generic share links (project and scan),
and the Shared With Me endpoints. The _Sharing & Invitations_ folder is split
into _Projects_, _Scans_, and _General_ subfolders, as is the dedicated
_Share Links_ folder (scan/project links plus the shared token preview/accept
requests). The Shared With Me surface covers both projects and scans.
Keep its idempotency headers, `If-Match` examples, and Sync folder aligned with
the generated OpenAPI contract.

## Before handoff

First complete the branch documentation gate in
[Documentation governance](documentation-governance.md). Then run:

```bash
yarn validate
yarn test:coverage
yarn build
```

The Git pre-commit hook invokes `corepack yarn validate` rather than a global
`yarn` binary. This keeps terminal and Git GUI commits on the version declared
in `packageManager`.

The commands above are the routine final verification gate. Do not run
`docker compose build`, start the Compose API/migrate services, or bring up the
full stack during normal task verification. Start
`docker compose -f docker-compose.local.yml up db -d` only when PostgreSQL is
unavailable, then run any required migrations and endpoint checks against the
natively started API.

Docker-specific verification is outside the routine handoff gate. Run targeted
Docker checks only when the user explicitly requests them or when the task's
acceptance criteria directly target the Dockerfile, Compose topology, container
startup, or container-only behavior. Report exactly which Docker checks were
run or why they were not applicable.

The handoff must state:

- Which documents were updated and why.
- Which relevant documents were reviewed but remained unchanged and why.
- Which validation commands passed.
- Which checks were not run and the reason.

## Prisma migrations

- Edit `prisma/schema.prisma`.
- Create development migrations with
  `yarn prisma:migrate:dev --name <meaningful-name>`.
- Review generated SQL before committing it.
- Commit schema and migration files together.
- Production/container startup applies existing migrations with
  `yarn prisma:migrate:deploy`; it never creates migrations.
- `yarn prisma:migrate:reset` drops and re-creates the database from migrations; it is
  guarded by `NODE_ENV=development` and refuses to run in any other environment.
- Never edit `src/generated/prisma` manually.

The committed `add_apple_auth` migration creates the Apple auth provider enum,
the `users` table and its unique `(provider, providerId)` constraint. The
`add_projects` migration creates the `projects` table with a UUID primary key,
a `users` foreign key with `ON DELETE RESTRICT`, a nullable soft-delete
timestamp, 50/500-character storage bounds, and an index on
`(ownerId, deletedAt, updatedAt, id)` for active owner listings. It also creates
the `ProjectRole` enum and `project_accesses` table used for revocable Viewer
access. The `add_scans` migration creates the `SyncStatus` and `AssetStatus`
enums and the `scans` table with a `projects` foreign key (`ON DELETE CASCADE`),
a `users` creator foreign key (`ON DELETE RESTRICT`), 100/500/2048-character
bounds, a composite unique `(projectId, clientMutationId)`, and indexes on
`(projectId, deletedAt, createdAt, id)` and `createdById`. The `add_scan_assets`
migration creates the `AssetType` enum and the `scan_assets` table with a
`scans` foreign key (`ON DELETE CASCADE`), a unique `(scanId, assetType)`
constraint, a unique `idempotencyKey`, and an index on `(scanId, status)`. The
`add_notes` migration creates the `NoteColor` enum and the `notes` table with a
`scans` foreign key (`ON DELETE CASCADE`), a `users` creator foreign key
(`ON DELETE RESTRICT`), a `position`/`orientation` JSONB pair, a
`modelVersion` column, and indexes on `(scanId, updatedAt, id)` and
`createdById`. The `add_invitations` migration creates the `InvitationStatus`
enum and the `invitations` table (unique `tokenHash`, `status`, `expiresAt`,
`sentAt`, `revokedAt`, project and creator foreign keys), and extends
`project_accesses` with `invitationId`, `acceptedAt`, and `declinedAt` columns.
The `declinedAt` column was temporary and is removed by the subsequent
migration. The `add_invitation_recipient_and_lifecycle` migration extends
`InvitationStatus` with `ACCEPTED` and `DECLINED`, adds `recipientEmail`,
`acceptedAt`, `declinedAt`, and `acceptedByUserId` to `invitations`, indexes
`(projectId, recipientEmail)`, adds a partial unique index on
`(projectId, recipientEmail)` for `PENDING` rows so at most one pending link
exists per recipient, and drops the now-unused `declinedAt` column from
`project_accesses`. Final decline lifecycle data is stored on the invitation
row (`status` and `declinedAt`); declined invitations never create project
access rows. The `add_scan_sharing_and_share_links` migration makes `projectId`
on `invitations` nullable and adds a `scanId` so a single invitation row models
either a project or a scan scope, adds partial unique indexes guarding one
`PENDING` invitation per `(scan, recipientEmail)`, adds a scope CHECK constraint
to `invitations`, and creates the `share_links` table (generic reusable links
with exactly one of `projectId`/`scanId`) and the `scan_accesses` table
(scan-level Viewer access). It also adds `shareLinkId` to `project_accesses` so
link-granted project access is traceable. The raw partial unique index and CHECK
constraints are expressed in the migration SQL, matching how the earlier
`(projectId, recipientEmail)` `PENDING` partial index is handled. The
`add_note_title_and_note_colors` migration extends the `NoteColor` enum with
`CYAN` and `GRAY` and adds a required `title` column (`VARCHAR(50)`) to the
`notes` table with a placeholder backfill so it applies even when the table
already contains rows.

The `add_sync_idempotency_conflicts` migration adds integer revisions to
Project, Scan, Note, ScanAsset, and ProjectAccess; Note/ScanAsset tombstones;
project readiness timestamps; scoped asset legacy-key uniqueness; encrypted
idempotency receipts; the append-only `sync_changes` feed; and per-user
`sync_conflicts`. Its reviewed SQL backfills readiness and initial UPSERT
snapshots for existing active resources/access. The follow-up
`backfill_note_title_in_sync_changes` migration adds the note `title` field
to existing NOTE UPSERT rows in `sync_changes` that were created without it.
The `add_access_viewer_removal` migration adds a `deletedAt` column to
`project_accesses` and `scan_accesses` so a Viewer can remove an item from
their own Shared With Me list (independent of the Owner's `revokedAt`). No
backfill runs: self-removal is a new capability, so no pre-existing access row
represents a Viewer's own removal, and every `revokedAt` value written before
this migration came from an Owner-only path (the revoke-viewer endpoint or a
project/scan deletion cascade). The four follow-up migrations
(`drop_project_accesses_status_idx_concurrently`,
`drop_scan_accesses_status_idx_concurrently`,
`create_project_accesses_status_idx_concurrently`,
`create_scan_accesses_status_idx_concurrently`) replace the
`(userId, revokedAt, <resource>Id)` indexes with
`(userId, deletedAt, revokedAt, <resource>Id)` to match the list predicate,
using `DROP`/`CREATE INDEX CONCURRENTLY` so the swap does not block live reads
or writes. Each of those four migrations contains exactly one statement:
Postgres rejects `CONCURRENTLY` inside a transaction block, and Prisma Migrate
applies a multi-statement `migration.sql` as one implicit transaction, so a
`CONCURRENTLY` statement must be the only statement in its migration to run
non-transactionally. Deploy migrations with `yarn prisma:migrate:deploy`;
never rewrite older migrations or generated Prisma Client. The
`add_user_display_name` migration adds a nullable `VARCHAR(100)`
`displayName` column to the `users` table; existing users keep a `null`
display name until they set one. The
`add_scan_project_updated_at_idx` migration adds
`@@index([projectId, deletedAt, updatedAt, id])` to `Scan`, alongside its
existing `createdAt`-keyed index, so update-order scan list queries have a
matching index. The `add_invitation_status_expires_at_idx` migration adds
`@@index([status, expiresAt])` to `Invitation`, matching the exact query
shape the invitation-expiry cleanup job (and the existing lazy-expire code in
`PrismaShareRepository.createInvitation`) use to find stale `PENDING` rows.
Both are regular (non-`CONCURRENTLY`) index creations; switch to the
`DROP`/`CREATE INDEX CONCURRENTLY` two-migration pattern described above if a
target environment's table sizes warrant an online build. No change was made
to `Project`, `Note`, or `ProjectAccess` indexes for this pass: `Project`
already has `@@index([ownerId, deletedAt, updatedAt, id])`, `Note` already has
`@@index([scanId, deletedAt, updatedAt, id])`, and `ProjectAccess`'s
`@@unique([projectId, userId])` already guarantees at most one access row per
project/user regardless of lifecycle state. A `pg_trgm`/GIN index for
free-text project-name search was deliberately not added: search already
works via case-insensitive `contains`, and no schema-level extension
(`CREATE EXTENSION`) is declared in this repository, so adding a real
full-text/fuzzy search index is out of scope for this pass and would need its
own migration and operational sign-off (elevated DB privilege to create the
extension).

`SYNC_CRYPTO_KEY` must be configured before the migrated application starts and
must remain unchanged. V1 ciphertext/cursor formats are versioned but do not
implement key rotation. `sync_changes` and `idempotency_receipts` have no V1
expiry or compaction job; retention is an operations follow-up.
Tests use Prisma delegate doubles; native migration and endpoint verification
use the PostgreSQL `db` container.

## Cleanup jobs

Three standalone scripts under `src/jobs/` implement the reliability cleanup
work: `yarn jobs:expire-invitations`, `yarn jobs:expire-upload-sessions`, and
`yarn jobs:cleanup-orphan-assets` run the compiled `dist/jobs/run-*.js`
entrypoints; `yarn dev:jobs:expire-invitations`,
`yarn dev:jobs:expire-upload-sessions`, and
`yarn dev:jobs:cleanup-orphan-assets` run the same jobs from source with TSX
for local iteration without a full `yarn build`.

Each script connects one Prisma Client, runs a single pass, disconnects, and
sets `process.exitCode = 1` on failure so an external scheduler can detect and
alert on a failed run — there is no internal HTTP endpoint or built-in
scheduler; an operator decides the cadence (host cron, a Kubernetes CronJob,
a CI scheduled pipeline) and invokes the script directly, for example
`node dist/jobs/run-invitation-expiry.js` against the production image with
its container command overridden. All three jobs are idempotent: each
selects rows by a condition (`status = PENDING AND expiresAt <= now`, a stuck
upload-session window, or an orphan-asset condition) that a prior successful
run already cleared, so re-running finds nothing left to do. See
[Architecture](architecture.md#cleanup-jobs) for what each job does and why
the orphan-asset job is deliberately database-driven only (it never lists or
reconciles the storage bucket) and why its deletes are hard deletes rather
than the soft-delete pattern used elsewhere.

`UPLOAD_SESSION_EXPIRY_GRACE_SECONDS` (default 300) and
`ORPHAN_ASSET_CLEANUP_BATCH_SIZE` (default 200) configure the upload-session
and orphan-asset jobs; see the root README's environment variable table.

## Dependency and generated-file policy

Direct dependencies are pinned and the full graph is locked by `yarn.lock`.
Regenerate Prisma after schema or Prisma version changes. Do not commit
`node_modules`, `dist`, coverage output, generated Prisma Client, secrets or
the local CodeGraph index.

Apple identity verification and RoomScan JWT signing use the pinned `jose`
dependency. Unit tests inject local signing keys and custom JWKS fetch
implementations, so the quality gate does not call Apple over the network.

HTTP quotas use the pinned `express-rate-limit` dependency. Tests construct
fresh process-local stores with small quotas and inject them through the
application factory. Production currently uses the same MemoryStore; adding
multiple API replicas requires a shared store such as Redis.

Presigned object-store URLs use the pinned `minio` client. Adapter unit tests
inject a fake client, so the quality gate never contacts a MinIO server.

Transactional invitation email uses the pinned `nodemailer` client through the
`SmtpMailer` adapter, which accepts an injected transporter so the quality gate
never contacts an SMTP server. Development and test default to
`MAIL_PROVIDER=log`, which writes messages to the application log instead of
delivering them; `log` is rejected in staging and production, so those
environments must set `MAIL_PROVIDER=smtp`.

Update this document in the same branch whenever development commands, required
tool versions, environment setup, tests, coverage, hooks, CI, Docker, Prisma
workflow, dependency policy, generated artifacts, or handoff requirements
change.
