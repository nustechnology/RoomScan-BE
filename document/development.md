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
   token secret must contain at least 32 characters.
4. Run `yarn install --immutable` and `yarn prisma:generate`.
5. Start PostgreSQL with `docker compose up db -d` when it is not already
   running and healthy; leave an existing healthy container running.
6. Run `yarn prisma:migrate:deploy` to apply the committed schema migration.
7. To use the local Apple-login shortcut, set
   `LOCAL_TEST_AUTH_ENABLED=true`, run `yarn seed:local`, and start the API with
   `yarn dev`.

Docker supplies PostgreSQL (and optionally MinIO) in the standard local
workflow. The default `STORAGE_PROVIDER=local` needs no extra service, so
MinIO is not part of the routine setup. To exercise the real presigned-URL
provider instead, run `docker compose up minio -d` (the MinIO service requires
`MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` from `.env`; its API and console
ports publish on the loopback interface), set `STORAGE_PROVIDER=minio` with the
matching `STORAGE_BUCKET`, `STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY_ID` and
`STORAGE_SECRET_ACCESS_KEY` values from `.env.example`, and start the API. Run
Prisma commands, seeds, the API, validation, tests, coverage and builds
natively with Yarn. If the `db` service is already healthy, leave it running
across tasks; do not restart or recreate it as part of final verification.

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
remain reachable.

The local seed is idempotent and refuses to run unless
`NODE_ENV=development`. It creates (or refreshes) the fixed local Apple user,
then seeds three demo projects owned by that user, each with room scans that
exercise a range of asset and sync states, plus text notes anchored to the
primary project's scans, so the list, pagination, sort, and detail screens can
be tried without manual setup. It also seeds four shared projects
the local user accepted (or was granted) as a Viewer — "Garden House"
(`ACTIVE`), "Maple Cottage" (`REVOKED`), "Willow Townhouse"
(`PROJECT_DELETED`), and "Cedar Bungalow" (`TEMPORARILY_UNAVAILABLE`) — so the
Shared With Me list exercises every status and the viewer-removal flow is
demoable locally. With the shortcut enabled, use:

```json
{
  "identityToken": "roomscan-local-test-user"
}
```

at `POST /api/v1/auth/apple`. The response contains normally signed RoomScan
access and refresh JWTs for `local-test@roomscan.dev`. Other identity tokens
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
sequential upload flow, the invitation sharing flow (including the `409`
states and token rotation), and the Shared With Me endpoints.

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
full stack during normal task verification. Start `docker compose up db -d`
only when PostgreSQL is unavailable, then run any required migrations and
endpoint checks against the natively started API.

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
`(projectId, recipientEmail)` `PENDING` partial index is handled.
Tests use Prisma delegate doubles; native migration and endpoint verification
use the PostgreSQL `db` container.

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
