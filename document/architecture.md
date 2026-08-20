# Architecture

RoomScan Backend is a single Express service using native ECMAScript modules.
It starts from `src/server.ts`, while `src/app.ts` creates the HTTP application
from injected dependencies. Keeping `app.listen` outside the app factory makes
API tests deterministic and prevents them from opening network ports.

The current product-facing scope contains health checks, Apple Sign-In
authentication with refresh-token rotation, Owner/Viewer project management,
room-scan metadata, scan asset upload/download, text notes anchored to scan
models, project and scan sharing through expiring invitation links and reusable
share links, and a Viewer-facing Shared With Me surface for both accepted
projects and scans. The Prisma
schema owns the `User`, `RefreshToken`, `Project`, `ProjectAccess`, `Scan`,
`ScanAccess`, `ShareLink`, `ScanAsset`, `Note`, and `Invitation` models.

## Request flow

1. Pino HTTP attaches a request ID and structured request logger.
2. Helmet and CORS apply security and cross-origin policies.
3. A general IP rate limiter protects `/api/v1` before request bodies are
   parsed, excluding liveness and readiness. The Apple authentication
   limiter is mounted path-specifically at `/api/v1/auth/apple` and the
   token-refresh limiter at `/api/v1/auth/refresh`, both at the
   same stage before body parsing, so every attempt on those paths
   consumes the corresponding quota regardless of parse outcome.
4. Compression and body parsers apply transport policies.
5. Swagger or versioned API routers handle the request.
6. Zod validates request/response data and supplies OpenAPI schemas.
7. The well-known router serves the Apple App Site Association file at the
   host root `/.well-known/apple-app-site-association`, outside `/api/v1` and
   without authentication or rate limiting.
8. Unknown routes and thrown errors pass through the central error middleware.
9. The response contains a request ID without exposing internal exceptions.

## Boundaries

- `config`: environment validation and stable application constants.
- `common`: reusable HTTP errors, middleware, rate-limit policies and schemas.
- `infrastructure`: PostgreSQL/Prisma, Apple identity-token verification,
  RoomScan token issuance and logging implementations.
- `modules`: product-facing route modules. Each module owns its schemas,
  router and OpenAPI registration.
- `openapi`: combines module registries into the public OpenAPI document.

The `well-known` module serves static discovery files at the host root, not under
`/api/v1` and not part of the OpenAPI document. It currently exposes
`/.well-known/apple-app-site-association`, which returns the Apple universal-link
app-links declaration (`application/json`) so invitation links
(`{INVITATION_BASE_URL}/invitations/{token}`) can open the native app. Because
Apple fetches this without credentials, the route requires no authentication and
is exempt from the API rate limiter.

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

The refresh JWT is issued for the mobile client. `POST /api/v1/auth/refresh`
consumes a valid refresh JWT, revokes it, and returns a new access+refresh pair.
Rotation is stateful: each issued refresh JWT has a unique `jti` persisted in
the `RefreshToken` model. The repository stores the `jti`, `userId`, and
`expiresAt` on creation and sets `revokedAt` on rotation. A reused `jti` is
rejected with `INVALID_REFRESH_TOKEN`. The refresh verifier accepts only
HS256-signed tokens with `tokenType: "refresh"` and the refresh-token secret.

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

An `optionalAuthenticate` variant uses the same verification but never rejects:
a request without an `Authorization` header, or with a malformed or invalid
token, proceeds anonymously without `request.locals`, while a valid token loads
the current user as usual. The invitation preview endpoint uses it so the
landing page works for anonymous recipients and still reports whether the
current user already has access when a valid token is supplied.

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
active-owner listing ordered by latest activity. Every project read embeds its
active scans as lightweight summaries (`id`, `name`, `description`, `thumbnail`,
`noteCount`, `assetStatus`, `syncStatus`, `createdAt`) ordered newest-first, so
project list and detail responses carry the scans without a second round trip;
`scanCount` counts the same non-deleted scans.

Canonical project detail resolves the record and the caller's Owner or active
Viewer role in one repository lookup. An Owner update performs its guarded
write and response read in one transaction, so an overlapping deletion cannot
turn an already-applied update into a not-found response.

Deletion marks `Project.deletedAt`, revokes active `ProjectAccess` records,
soft-deletes active scans, notes, and assets, and emits tombstones for every
affected resource in one transaction. A repeated deletion by the same Owner is
idempotent. Physical cleanup remains outside this module; invitation cleanup is
owned by the Share module below.

The owner relation uses `onDelete: Restrict` to prevent accidental project loss
when a user is deleted. Project names are not unique per owner.

## Scan module

The Scan module provides authenticated scan-metadata creation, listing, detail,
Owner-only updates, and soft deletion. Scans belong to exactly one project
(`onDelete: Cascade` from the parent project) and record their creator
(`onDelete: Restrict` to the user).

`ScanService` depends on a `ScanRepository` interface plus the shared
`ProjectPermissionService`, so it reuses the same Owner/active-Viewer access
rules as the Project module. Every project-level permission failure is converted
to `ScanNotFoundError`, so scan endpoints expose the same hidden 404 behavior as
projects.

`PrismaScanRepository` performs the `clientMutationId` idempotency check at the
database boundary scoped to the parent project, backed by the composite
`@@unique([projectId, clientMutationId])` constraint, so the same value in a
different project never collides. Creating a scan with a reused active
`clientMutationId` returns the existing scan as not created; a reused value
matching a soft-deleted scan returns `409 IDEMPOTENCY_KEY_CONFLICT` and never
restores the tombstone. A concurrent
duplicate insert raises `P2002`, which the repository catches and resolves to
the existing row instead of rethrowing. The repository also performs
allow-listed sorting with a stable `id` tie-breaker and offset pagination. An
Owner update runs its guarded write and response read in one transaction.
Deleting a scan marks `Scan.deletedAt`, soft-deletes its active `ScanAsset` and
`Note` descendants, rolls up the project readiness, and writes all
tombstones in the same transaction; a repeated delete by the same Owner is
idempotent.

The `Scan` model stores metadata only: name, description, thumbnail reference,
`assetStatus`, `syncStatus`, and `modelVersion`, plus a real `noteCount` derived
from the note rows through Prisma's `_count`. Scan-asset upload and download
live in the Scan Asset module below, and notes in the Note module below.

## Scan Asset module

The Scan Asset module manages upload sessions and download URLs for a
scan's model and thumbnail. It depends on a `ScanAssetRepository`, the shared
`ProjectPermissionService` (via `ScanRepository.findProjectId`), a
`StorageAdapter`, and the configured URL TTLs and size limits.

`ScanAssetService` validates the content type and size for the requested
`assetType`, creates or re-uses a single `ScanAsset` row per `(scan, assetType)`,
and mints upload and download URLs carrying the configured TTL metadata. Model
scan files must be between the configured `ASSET_MIN_MODEL_SIZE_BYTES` and
`ASSET_MAX_MODEL_SIZE_BYTES` (0–200 MB); thumbnails are capped by
`ASSET_MAX_THUMBNAIL_SIZE_BYTES`. The
repository resolves a concurrent create for the same `(scan, assetType)` key to
the existing row instead of surfacing the unique-constraint error, so the
duplicate request is reported as not created and returns `200`. An active,
unexpired upload session is returned idempotently (`200`), and refreshing an
expired session also returns `200` rather than reporting a new creation.
Completion is idempotent and, when the provider can verify the object, marks the
asset `UPLOADED`. The provider verifies that the uploaded object exists and that
its stored size and content type exactly match the persisted session's
`contentType` and `sizeBytes`; a missing or mismatched object marks the asset
`FAILED` and surfaces `409 ASSET_UPLOAD_FAILED`. Successful `MODEL` completion
also updates the parent scan's `assetStatus`/`syncStatus`, and retrying a
completed upload re-applies that update so the scan recovers when the earlier
scan update failed. Thumbnail completion leaves the scan status unchanged but
persists a stable display URL (`StorageAdapter.createDisplayUrl`) onto the
scan's `thumbnail` field — re-applied on a completed retry — so project and
scan responses expose it. Download URLs are only issued for `UPLOADED` assets,
and the raw `storageKey` field is omitted from responses. Storage failures
while minting upload or download URLs or while verifying an upload surface as
`503 STORAGE_UNAVAILABLE`.

Create-session retries use the required `Idempotency-Key` header. The deprecated
body `idempotencyKey` remains an alias and must match the header when both are
present; new asset rows never store the raw key. A MODEL asset that reached
`UPLOADED` is immutable in SIT-39: a new session returns
`409 MODEL_ALREADY_COMPLETED` instead of resetting or replacing it.

Permissions mirror the Scan module: the project Owner creates/completes uploads,
and the Owner or active Viewers list metadata and receive download URLs. All
permission failures surface as hidden 404s, and revoked Viewers or deleted
projects/scans cannot mint series of new download URLs because the underlying
access lookup runs on every request.

## Note module

The Note module manages text notes anchored to 3D positions inside a scan model.
It depends on a `NoteRepository`, the shared `ProjectPermissionService`, and
`ScanRepository`'s project lookup. Notes belong to exactly one scan
(`onDelete: Cascade` from the scan) and record their creator
(`onDelete: Restrict` to the user). The `Note` model stores `content`,
`color` (a `NoteColor` preset), a required `{ x, y, z }` `position` stored
relative to the model, an optional `{ x, y, z }` `orientation`, and the
`modelVersion` the note was anchored against.

`NoteService` converts project-level permission failures to hidden 404s scoped
to the resource: scan-scoped endpoints return `SCAN_NOT_FOUND`, and note-scoped
endpoints return `NOTE_NOT_FOUND`. Only the project Owner creates, edits, moves,
and deletes notes; an active Viewer may list and read them. Creating or moving a
note validates that its `modelVersion` equals the parent scan's current model
version and rejects a mismatch with `409 MODEL_VERSION_MISMATCH`, so notes
cannot be anchored to a stale model revision.

`PrismaNoteRepository` filters active reads through `Note.deletedAt` and a
non-deleted scan. Note delete is a soft-delete tombstone. Every note mutation
increments the note revision, rolls up the scan revision, and
writes normalized change snapshots in one transaction. Note content is never
written to logs; the error envelope returns only stable codes and messages.
The repository derives the scan's real `noteCount` from active note rows.

## Sync, idempotency, and optimistic concurrency

The Sync module owns `GET /api/v1/sync/changes` and
`GET /api/v1/sync/status`. `SyncChange` is an append-only event log ordered by
a `BigInt` sequence. Each event stores a normalized immutable client DTO (or a
DELETE tombstone), resource revision, project/owner visibility scope, optional
target user, readiness state, and timestamps. Snapshots and incremental pages
read historical event data instead of reconstructing old state from mutable
domain tables. Owner events are project-wide; Viewer grants append a targeted
access UPSERT and project bootstrap, while revocation appends a targeted
self-access tombstone and active access controls later event visibility.

Initial pulls freeze a sequence watermark and page the latest visible UPSERT
per resource by `(resourceType, resourceId)`. Incremental and `since` pulls are
ordered by sequence. Cursors are versioned, user-bound payloads authenticated
with HMAC; cross-user, malformed, or tampered cursors fail closed. Status is
derived from active MODEL asset lifecycles plus unresolved per-user
`SyncConflict` rows, with priority `CONFLICT > FAILED > SYNCING > PENDING >
SYNCED`. A zero-scan project is fully synced.

Selected creates store an encrypted `IdempotencyReceipt` in the same Prisma
transaction as domain writes, revision roll-ups, and sync events. Scope is
authenticated user + operation + concrete parent + SHA-256 key hash; request
hashing uses canonical validated JSON. AES-256-GCM receipt encryption and
cursor HMAC keys are independently derived from `SYNC_CRYPTO_KEY` with HKDF.
Same-key/same-request retries return the original status and body; another
payload returns `409`. Presigned URLs are prepared before the transaction, so
storage failure writes no receipt. Create Scan commits optional asset sessions
together with the scan and one receipt.

`If-Match` is read and validated by the shared `parseIfMatch` helper, and
`Idempotency-Key` by the shared `resolveIdempotencyKey` helper (both backed by
the Zod header schemas in `common/schemas/sync-headers.ts`), rather than the
generic `validateRequest` middleware on Project, Scan, and Note routes: the
idempotency key may arrive through a deprecated body alias, and each malformed
header must surface a distinct stable error code. The Create Upload Session
endpoint additionally registers `IdempotencyKeyHeaderSchema` as a `headers`
source in `validateRequest`, so the middleware enforces header presence and
format (returning `400 VALIDATION_ERROR` on a missing or malformed key) before
`resolveIdempotencyKey` reconciles the deprecated body alias. The
`validateRequest` middleware normalizes header keys case-insensitively via
`normalizeHeaders` before Zod parsing, so `idempotency-key`, `Idempotency-key`,
and `IDEMPOTENCY-KEY` all match the schema's `Idempotency-Key` field.

Project, Scan, Note, ScanAsset, and ProjectAccess carry integer revisions.
Owner PATCH/DELETE routes require a strong `If-Match: "N"`; guarded writes use
the expected revision atomically. A stale write commits a per-user conflict
ledger row plus a targeted refresh snapshot/tombstone, then returns
`409 REVISION_CONFLICT`. Delete wins over stale update and no stale mutation can
clear a tombstone. Consuming the refresh cursor acknowledges the conflict and
appends a targeted non-conflict snapshot. Acknowledging a conflict that leaves
a project fully synced also increments the project revision and emits a
project UPSERT sync change so other clients observe the status transition.
Successful current-revision writes resolve earlier conflicts in their domain
transaction.

## Share module

The Share module implements project and scan sharing through expiring, token-based
links. It depends on a `ShareRepository` (an `InvitationRepository`-style
interface that also manages Viewer access records and generic share links), a
`Mailer`, a logger, a `clock`, the configured invitation TTL
(`INVITATION_TTL_SECONDS`), and the client-facing base URL
(`INVITATION_BASE_URL`). `ShareService` owns per-recipient invitations and the
token preview/accept/decline resolution; `ShareLinkService` owns the generic,
reusable share-link surface (create, list, revoke) and never sends email. Share
management (create, resend, list, revoke) is Owner-only; a non-owner receives
`403 NOT_OWNER`, while a missing or deleted project returns
`404 PROJECT_NOT_FOUND` and a missing or deleted scan returns
`404 SCAN_NOT_FOUND`. The Owner of a scan is always the owner of its parent
project.

An `Invitation` row is a per-recipient link record scoped to exactly one
resource (`projectId` or `scanId`): `recipientEmail`, `tokenHash`
(SHA-256 of the raw token; the raw token is never stored), `status` (`PENDING`,
`ACCEPTED`, `DECLINED`, or `REVOKED`), `expiresAt`, `sentAt`, `acceptedAt`,
`acceptedByUserId`, `declinedAt`, and `revokedAt`. The raw token is 32 random
bytes encoded as base64url and the `invitationUrl` returned to the owner is
`{INVITATION_BASE_URL}/invitations/{rawToken}`. Creating an invitation sends an
AC5-style email built by `buildInvitationEmail` with either the project or the
scan template; a delivery failure is logged and never fails the request. Partial
unique indexes on `(projectId, recipientEmail)` and `(scanId, recipientEmail)`
for `PENDING` rows enforce at most one pending link per recipient and scope: the
repository create revokes any expired pending link for the same
`(project, recipientEmail)` or `(scan, recipientEmail)` and inserts the new link
in one database transaction, so a concurrent duplicate raises the
unique-constraint violation and is mapped to `409 INVITATION_ALREADY_SENT`. An
expired link therefore does not block re-inviting the recipient. Resending
rotates the token, extends `expiresAt`, updates `sentAt`, and re-sends the email
with the matching scope template.

A `ShareLink` row is a generic, reusable link with no recipient, scoped to
exactly one resource (`projectId` or `scanId`): `createdById`, `tokenHash`,
`expiresAt`, and `revokedAt`. Acceptance never changes the link, so it remains
usable by other users until it expires or the Owner revokes it. A `ScanAccess`
row mirrors `ProjectAccess` for the scan scope: `scanId`, `userId`, `role`,
`invitationId`/`shareLinkId`, `acceptedAt`, and `revokedAt`, with a
`@@unique([scanId, userId])` constraint. Scan-level Viewer access grants read
access to that scan, its notes, and its assets without project-level access;
the Scan, Note, and Scan Asset modules include active `ScanAccess` rows in their
permission lookups (via `ScanPermissionService`, which resolves the role for a
scan from project ownership, project Viewer access, or scan Viewer access).

Acceptance is open for invitations: the first signed-in user to redeem a pending
invitation makes it `ACCEPTED` (recording `acceptedAt` and `acceptedByUserId`)
and receives an active Viewer access row in one database transaction —
`ProjectAccess` for project scope or `ScanAccess` for scan scope. The `@@unique`
constraint on `(projectId, userId)` or `(scanId, userId)` guarantees at most one
access row per resource per user, so accepting can never create a duplicate, and
the repository guards the status write with a `status = PENDING` predicate so a
concurrent double-accept resolves to `409 INVITATION_ALREADY_ACCEPTED`. A user
with an active access row cannot accept or decline again
(`409 ACCESS_ALREADY_EXISTS`), an accepted or declined invitation is terminal,
and the resource Owner cannot accept or decline
(`409 CANNOT_ACCEPT_OWN_INVITATION`).

Reusable share links behave differently: acceptance never transitions the link —
a `ShareLink` row retains its status (`ACTIVE`, `EXPIRED`, or `REVOKED`) and
remains redeemable by any other signed-in user until it expires or the Owner
revokes it; accepting only creates the access row (via `acceptedAt`) and never a
second access. A revoked or expired share link cannot be accepted
(`409 SHARE_LINK_REVOKED` or `409 SHARE_LINK_EXPIRED`), has no decline
operation, and newly created access via a revoked or expired link is rejected —
`grantProjectAccess`/`grantScanAccess` refuse to re-grant once the user has a
previously revoked access record, and re-granting an active user is blocked by
`409 ACCESS_ALREADY_EXISTS`.

Revoked (`409 INVITATION_REVOKED`), expired (`409 INVITATION_EXPIRED`), accepted
(`409 INVITATION_ALREADY_ACCEPTED`), and declined (`409 INVITATION_DECLINED`)
invitations cannot be accepted, declined, resend, or revoked, and a revoked or
expired invitation token can no longer be redeemed (it is not reusable);
revoking an already revoked invitation remains idempotent and returns its
existing revocation timestamp.

Preview (`GET /invitations/:token`) requires no authentication and resolves
either an invitation or a generic share link, returning a discriminated response
with `type` (`invitation` or `share-link`), `scope` (`project` or `scan`), the
matching entity (`project` or `scan`), and the link status; when a valid Bearer
token is supplied it additionally reports `hasAccess`. A project is only
shareable once it has at least one non-deleted scan with an uploaded model
(`assetStatus = UPLOADED`), and a scan is shareable only once that scan has an
uploaded model; otherwise creation returns `409 PROJECT_NOT_SHAREABLE` or `409
SCAN_NOT_SHAREABLE`. Revoking a Viewer simply sets `revokedAt`; downstream
enforcement that revoked Viewers lose project, scan, note, and asset download
access is inherited from the shared `ProjectPermissionService` and
`ScanPermissionService` access lookups, which filter on active (`revokedAt:
null`) access on every request. A Viewer who removes an item from their Shared
With Me list has `deletedAt` on their access row instead and is treated the same
way: every active-access lookup excludes `deletedAt`-non-null access, so a
self-removed Viewer loses project, scan, note, and asset-download access just
like an Owner-revoked one. Re-accepting an invitation or re-granting a share
link on a previously self-removed access resets `deletedAt: null` so the Viewer
is re-activated.

## Shared With Me module

The Shared With Me module is the Viewer-facing read side of sharing. It lists
the projects the current user accepted as a Viewer, opens an active shared
project read-only, and lets the user remove a project from their own list. It
depends on a narrow `SharedProjectsRepository` interface and derives everything
from existing rows. `ProjectAccess` rows distinguish lifecycle state with two
independent timestamps: `revokedAt` (set only when the Owner revokes a Viewer)
and `deletedAt` (set only when the Viewer removes the project from their own
Shared With Me list). The module reads `ProjectAccess` membership, the `Project`
row (including `deletedAt` and `updatedAt`), the `owner` relation, and a
non-deleted scan count. The migration
that introduced `ProjectAccess.deletedAt` also keeps the access-row list index
(`userId, deletedAt, revokedAt, projectId`) aligned with the list predicate.

`SharedProjectsService` computes a `status` for each listed entry:
`ACTIVE` (live project, active access), `REVOKED` (live project, owner-revoked
access), `PROJECT_DELETED` (deleted project whose access was revoked), and
`TEMPORARILY_UNAVAILABLE` (a defensive state for an inconsistent record, such as
a deleted project whose access is still active). A Viewer-removed entry has
`deletedAt` set and is filtered out of the list entirely, so it has no status.
List and detail map to a
read-only response whose `permissions` always has `role: VIEWER` with `canView`
true only for `ACTIVE`. Detail only returns a project while it is `ACTIVE`;
revoked, deleted, removed, and never-shared projects are hidden behind the
standard `404 PROJECT_NOT_FOUND`.

`PrismaSharedProjectsRepository` restricts every `project_accesses` list/detail
lookup to `VIEWER` rows with `deletedAt: null`: list filters by `userId`,
`VIEWER` role, and `deletedAt`, detail and access-status checks match on
`(projectId, userId)` with the same role and removal filter, and removal runs a
transactionally guarded update on the access row (`role: VIEWER`,
`deletedAt: null`, and the access's own `revision` compare-and-set). Removal
sets `deletedAt`, works on any status (including an Owner-revoked entry), is
idempotent on retry, increments the access revision, and emits Owner plus
targeted Viewer tombstones, so owner records are never returned or removed. A
concurrent Owner revocation (which also increments `revision`) wins the guarded
update against a same-time removal; the repository re-reads the row and, since
revocation alone never sets `deletedAt`, finds no tombstone and resolves to
`409 NOT_IN_SHARED_WITH_ME`. A concurrent second removal request instead loses
the update but finds the tombstone the winner already persisted, so it returns
`200` with that stored `deletedAt` rather than surfacing a conflict. Lookups
apply case-insensitive name search against the parent project, sort by a
to-one relation field with a stable project `id` tie-breaker, and paginate with
an offset. Owners never appear in the list, and a removal attempt by the
project Owner returns `403 NOT_SHARED_PROJECT`.

## Shared Scans module

The Shared Scans module is the scan-granularity counterpart of the Shared With
Me module. It lists the scans the current user accepted as a Viewer (via a
scan-level invitation or share link), opens an active shared scan read-only, and
lets the user remove a scan from their own list. It depends on a narrow
`SharedScansRepository` interface and derives everything from existing rows:
`ScanAccess` membership (using the same two-timestamp lifecycle as
`ProjectAccess`, with `revokedAt` for Owner revocation and `deletedAt` for
Viewer self-removal), the `Scan` row (including `deletedAt`, `updatedAt`, and
the creator relation), and a non-deleted note count. The migration that added
`ScanAccess.deletedAt` also aligns the access-row list index
(`userId, deletedAt, revokedAt, scanId`).

`SharedScansService` computes a `status` for each entry, mirroring the project
surface but at scan granularity: `ACTIVE` (live scan, active access), `REVOKED`
(live scan, revoked access), `SCAN_DELETED` (deleted scan whose access was
revoked), and `TEMPORARILY_UNAVAILABLE` (a defensive state for an inconsistent
record). A Viewer-removed entry has `deletedAt` set and is filtered out of the
list, so it has no status. List and detail map to a read-only response whose
`permissions` always has `role: VIEWER` with `canView` true only for `ACTIVE`.
Detail only returns a scan while it is `ACTIVE`; revoked, deleted, removed, and
never-shared scans are hidden behind the standard `404 SCAN_NOT_FOUND`.

`PrismaSharedScansRepository` restricts every `scan_accesses` list/detail lookup
to `VIEWER` rows with `deletedAt: null`: list filters by `userId`, the `VIEWER`
role, and `deletedAt`, detail and access-status checks match on `(scanId, userId)`
with the same role and removal filter, and removal runs a guarded `updateMany` on
the access row (`role: VIEWER`, `deletedAt: null`) that sets `deletedAt`, works
on any status, and is idempotent: a losing concurrent removal request re-reads
the row and returns `200` with the tombstone the winner already persisted
instead of failing. `ScanAccess` carries no `revision` column, so unlike
`ProjectAccess` a concurrent Owner revocation cannot contend with this update at
all — revocation only sets `revokedAt`, which self-removal never inspects — so
the two proceed independently and removal only resolves to
`409 NOT_IN_SHARED_WITH_ME` when the access row is missing entirely (never
granted, or owned by the caller). Owner records are never returned or removed.
Lookups apply case-insensitive name search against the parent scan, sort by a
to-one relation field with a stable scan `id` tie-breaker, and paginate with an
offset. The "owner" check for removal resolves the scan's project owner; owners
never appear in the list, and a removal attempt by the scan Owner returns
`403 NOT_SHARED_SCAN`.

## Mail

`src/infrastructure/mail` defines a narrow `Mailer` interface (`sendMail`), plus
`LogMailer` and `SmtpMailer` adapters selected by `MAIL_PROVIDER` in the
composition root. `LogMailer` writes message metadata to the application log and
is only allowed when `NODE_ENV` is development or test; staging and production
reject `MAIL_PROVIDER=log` and require the SMTP adapter. `SmtpMailer` wraps an
injected nodemailer transporter (`createNodemailerTransport` builds one from
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_SECURE`, with
explicit connection, greeting, and socket timeouts) and sends with the
configured `MAIL_FROM` address; the transporter is injected so tests use a fake
and never touch the network. Module routes do not change when the provider
changes, and `ShareService` treats a failed send as a logged warning.

## Storage

`src/infrastructure/storage` defines a narrow `StorageAdapter` interface
(`buildObjectKey`, `createUploadUrl`, `createDownloadUrl`, `verifyObject`,
`createDisplayUrl`). The composition root selects the adapter from
`STORAGE_PROVIDER`; module routes do not change when the provider changes.

`LocalStorageAdapter` is used in development and tests. It mints unsigned test
URLs; the requested expiry is returned as TTL metadata only and is neither
encoded into a capability nor enforced, and `verifyObject` always accepts
completion because the adapter does not persist bytes. `createDisplayUrl`
returns a stable `http://storage.local/download/...` URL. Configuration rejects
`STORAGE_PROVIDER=local` when `NODE_ENV=production`.

`MinioStorageAdapter` is the S3-compatible object-store provider. It is
selected with `STORAGE_PROVIDER=minio`, which requires `STORAGE_BUCKET`,
`STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY_ID` and `STORAGE_SECRET_ACCESS_KEY`.
The endpoint is `host[:port]`; `STORAGE_USE_SSL` switches between HTTP and
HTTPS. The adapter lazily creates the configured bucket on first use and caches
the creation per process, mints presigned PUT and GET URLs whose expiry is
enforced by MinIO, and verifies uploads with a head request (`statObject`):
`verifyObject` receives the persisted session's `contentType` and `sizeBytes`
and returns `false` when the object is missing or its stored size or content
type does not match, while other storage failures propagate and surface as
`503 STORAGE_UNAVAILABLE`. The presigned PUT URL does not sign content-type or
size constraints, so exact size and content-type enforcement happens at
completion time through this stored-object comparison. `createDisplayUrl`
returns a stable, non-expiring object URL (`[scheme]://[endpoint]/[bucket]/[key]`,
overridable via `displayBaseUrl`), so it requires the bucket or objects to be
publicly readable or a CDN/reverse proxy in front of MinIO; it is used to
persist scan thumbnails.

## Nonce binding

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

The composition root creates independent general API, Apple authentication, and
token-refresh rate limiters and injects them into the application factory. The
general policy allows 120 requests per 60 seconds for each client IP. Apple
authentication has an additional policy allowing 20 attempts per 15 minutes.
Token refresh has an additional policy allowing 10 attempts per 15 minutes.
Every Apple and refresh attempt counts regardless of its outcome.

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
repository, the project repository, the scan repository, the scan-asset
repository, the refresh-token repository, the note repository, the share
repository, the shared-projects repository, the shared-scans repository, the
sync repository, and the idempotency executor, plus the storage,
sync-cryptography, and mail adapters. It also creates the three
rate-limit middleware instances, the access-token and refresh-token verifiers,
the project and scan permission services, the project service, the scan service,
the scan-asset service, the refresh-token service, the note service, the share
service, the share-link service, the shared-projects service, the
shared-scans service, and the sync service once per process. Product modules
never import the Prisma client
directly. The unique provider identity constraint makes concurrent first-time
Apple logins idempotent at the database boundary. The projects table has a
foreign key to users with `onDelete: Restrict`; project access has unique
`(projectId, userId)` membership, revocation state, and an optional
`invitationId` or `shareLinkId` with an acceptance timestamp. Scan access has
unique `(scanId, userId)` membership with the same lifecycle, and both access
models carry an independent viewer-removal `deletedAt` plus a `revokedAt` for
Owner revocation. Notes belong to a
scan with `onDelete: Cascade` and to a creator with `onDelete: Restrict`.
Invitations belong to a project or scan with `onDelete: Cascade` and to a
creator with `onDelete: Restrict`; their `tokenHash` is unique, their
`recipientEmail` is indexed per project and per scan, and the access rows
referencing them use `onDelete: SetNull` so revoking an invitation never orphans
Viewer access. Share links belong to a project or scan with
`onDelete: Cascade` and to a creator with `onDelete: Restrict`.

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
