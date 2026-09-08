# API conventions

## Routing

- Public application routes are versioned under `/api/v1`.
- Liveness and readiness are `/api/v1/health` and `/api/v1/ready`.
- Apple authentication is `POST /api/v1/auth/apple`.
- Token refresh is `POST /api/v1/auth/refresh`.
- Current user profile is read at `GET /api/v1/users/me` and updated at `PATCH /api/v1/users/me`.
- Project management is `POST`, `GET`, `GET/:id`, `PATCH/:id`, and `DELETE/:id` at
  `/api/v1/projects`.
- Scan metadata is `POST` and `GET` at `/api/v1/projects/:projectId/scans`, and
  `GET`, `PATCH`, and `DELETE` at `/api/v1/scans/:scanId`.
- Scan assets (model/thumbnail upload and download) live under `/api/v1/scans`,
  with upload-session completion and failure at `/api/v1/upload-sessions`.
- Notes are `POST` and `GET` at `/api/v1/scans/:scanId/notes`, and `GET`,
  `PATCH`, and `DELETE` at `/api/v1/notes/:noteId`, with the move operation at
  `PATCH /api/v1/notes/:noteId/position`.
- Sharing creates, resends, and revokes invitation links at
  `POST /api/v1/projects/:projectId/invitations`,
  `POST /api/v1/scans/:scanId/invitations`,
  `POST /api/v1/invitations/:invitationId/resend`, and
  `DELETE /api/v1/invitations/:invitationId`; recipients preview, accept, and
  decline at `GET`, `POST`, and `POST` under `/api/v1/invitations/:token`; and
  share management lists and revokes Viewer access at
  `GET /api/v1/projects/:projectId/shares`,
  `DELETE /api/v1/projects/:projectId/shares/:userId`,
  `GET /api/v1/scans/:scanId/shares`, and
  `DELETE /api/v1/scans/:scanId/shares/:userId`.
- Generic share links (reusable, no recipient email) are created, listed, and
  revoked at `POST`, `GET`, and `DELETE` under
  `/api/v1/projects/:projectId/share-links` and `/api/v1/scans/:scanId/share-links`;
  their tokens resolve through the same `/api/v1/invitations/:token` preview and
  accept endpoints as invitations.
- Shared With Me lists, opens, and self-removes accepted projects for the
  current Viewer at `GET /api/v1/shared-projects`,
  `GET /api/v1/shared-projects/:projectId`, and
  `DELETE /api/v1/shared-projects/:projectId`; the same read-only surface is
  available for scan-level sharing at `GET /api/v1/shared-scans`,
  `GET /api/v1/shared-scans/:scanId`, and `DELETE /api/v1/shared-scans/:scanId`.
- Offline synchronization pulls visible changes and readiness at
  `GET /api/v1/sync/changes` and `GET /api/v1/sync/status`.
- Swagger UI remains at `/api-doc`; raw OpenAPI is `/api-doc.json`.
- The Apple App Site Association file is served without authentication at the
  host root `GET /.well-known/apple-app-site-association` with content type
  `application/json`, declaring the `B66DTGYFS9.com.nus.roomscan` app and the
  `/invitations/*` path so universal links can open invitation links in the
  native app.
- Resource paths use plural nouns and kebab-case when business modules arrive.

## Validation and documentation

Define Zod schemas inside the owning module. Reuse those schemas for runtime
validation and register them with the module's `OpenAPIRegistry`. Every public
route must appear in the generated OpenAPI document and have response schemas
for its success and expected error statuses.

Do not maintain duplicate JSDoc or handwritten YAML schemas.

Validated request values are read from `response.locals.validated`; handlers
must not continue using the unvalidated request source after validation.

## Errors

Expected errors use `AppError` and the following envelope:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Safe client-facing message",
    "details": {}
  },
  "requestId": "request-correlation-id"
}
```

`details` is optional. Never expose stack traces, SQL, credentials, connection
strings or raw dependency errors. Use 400 for validation/malformed input, 404
for missing routes/resources, 409 for state conflicts, 401 for rejected
credentials, 429 for an exceeded request quota and 503 for unavailable
dependencies.

Every response includes a request correlation ID in the `x-request-id` header.
Error responses also include it in the `requestId` field. A non-empty incoming
`x-request-id` may be reused; otherwise the application generates one.

## Rate limiting

Public API traffic has three process-local per-IP policies:

- `/api/v1` allows 120 requests per 60 seconds.
- `POST /api/v1/auth/apple` additionally allows 20 requests per 15 minutes.
- `POST /api/v1/auth/refresh` additionally allows 10 requests per 15 minutes.

`/api/v1/health`, `/api/v1/ready`, `/api-doc` and `/api-doc.json` are exempt.
All Apple and refresh attempts count, including validation, credential and dependency
failures. IPv6 clients are grouped by `/56`.

Four additional route-specific policies protect sensitive actions, layered on
top of the general `/api/v1` policy (a request can be blocked by either):

- `POST /api/v1/projects/:projectId/invitations` and
  `POST /api/v1/scans/:scanId/invitations` (invitation creation) allow 20
  requests per 15 minutes.
- `POST /api/v1/invitations/:token/accept` (invitation acceptance) allows 30
  requests per 5 minutes.
- `POST /api/v1/scans/:scanId/assets/upload-sessions` (upload-session
  creation) allows 30 requests per 15 minutes.
- `GET /api/v1/scans/:scanId/assets/:assetType/download-url` (download-URL
  generation) allows 60 requests per 5 minutes.

These policies apply only to the exact route named above — invitation
preview (`GET /api/v1/invitations/:token`) and decline
(`POST /api/v1/invitations/:token/decline`) are not subject to the
invitation-accept policy, and listing scan assets
(`GET /api/v1/scans/:scanId/assets`) is not subject to either scan-asset
policy. All four counts, defaults, and windows are configurable via
environment variables (see the root README).

Allowed and rejected limited requests expose draft-8 `RateLimit` and
`RateLimit-Policy` headers. A rejected request additionally returns
`Retry-After`, HTTP 429 and:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests; please try again later"
  },
  "requestId": "request-correlation-id"
}
```

Rate-limit responses never expose the raw client IP, token, unhashed store key
or store details. Browser clients may read those headers and resource `ETag`
through CORS.

## Apple authentication

The request body contains a non-empty `identityToken` string of at most
16 KiB and an optional raw `nonce` string of at most 512 bytes. Unknown fields
are rejected. Clients send the lowercase hexadecimal SHA-256 digest of the raw
nonce to Apple, then send the raw value to this endpoint. After validating the
Apple signature, issuer, client audience, expiration, issued-at time and
subject, the server hashes the supplied raw nonce and compares it with the
token's `nonce` claim before looking up a user.

When the identity token contains a nonce claim, the request must contain the
corresponding raw nonce. When the token has no nonce claim, the request must
also omit the nonce for legacy compatibility. Missing, unexpected, or
mismatched nonce bindings return 401 with `INVALID_APPLE_IDENTITY_TOKEN`; they
are credential failures rather than 400 request-schema failures.

Successful authentication always returns 200:

```json
{
  "accessToken": "roomscan-access-jwt",
  "refreshToken": "roomscan-refresh-jwt",
  "user": {
    "id": "eb5d278f-c857-45c7-887d-7be65288cb75",
    "email": "user@example.com",
    "displayName": null,
    "provider": "apple"
  }
}
```

`user.email` and `user.displayName` may be `null`. The response never contains the Apple
subject, verification claims, signing details or secrets.

Malformed or unverifiable Apple tokens return 401 with
`INVALID_APPLE_IDENTITY_TOKEN`. Apple JWKS fetch failures return 503 with
`APPLE_IDENTITY_PROVIDER_UNAVAILABLE`. Exceeded API or Apple quotas return 429
with `RATE_LIMIT_EXCEEDED`. These errors use generic client-facing messages.
The endpoint does not exchange Apple authorization codes.

For local development only, `LOCAL_TEST_AUTH_ENABLED=true` with
`NODE_ENV=development` permits the fixed identity token
`roomscan-local-test-user`. That sentinel bypasses Apple cryptographic
verification, resolves the user provisioned by `yarn seed:local`, and otherwise
uses the normal user upsert and RoomScan JWT issuance flow. Any other token
still goes through Apple. Configuration rejects the flag in test, staging, and
production, so this shortcut is not part of the deployed OpenAPI contract.

## Refresh token rotation

`POST /api/v1/auth/refresh` accepts a RoomScan refresh JWT and issues a new
access+refresh pair. The old refresh token is revoked so each refresh JWT may
only be used once.

Request body:

```json
{ "refreshToken": "roomscan-refresh-jwt" }
```

Success `200`:

```json
{ "accessToken": "roomscan-access-jwt", "refreshToken": "roomscan-refresh-jwt" }
```

Errors:

| Code                    | HTTP | Meaning                                                |
| ----------------------- | ---- | ------------------------------------------------------ |
| `VALIDATION_ERROR`      | 400  | The request body is missing `refreshToken`             |
| `INVALID_REFRESH_TOKEN` | 401  | The supplied token is invalid, expired, or revoked     |
| `RATE_LIMIT_EXCEEDED`   | 429  | Per-IP quota exceeded (10 req / 15 min)                |
| `INTERNAL_SERVER_ERROR` | 500  | Unexpected failure without secret or database exposure |

Rotation is stateful: each issued refresh JWT has a unique `jti` (JWT ID)
persisted in the `refresh_tokens` table until it expires. Revocation sets
`revokedAt` without deleting the row, so every recorded JTI remains queryable
for audit and future theft-detection. The service consumes the presented JTI
atomically: a single database operation matches the unrevoked, unexpired row and
sets `revokedAt` in place of the former separate lookup-and-revoke. When an
already-revoked or unknown `jti` is consumed, the operation affects zero rows
and the endpoint returns 401 with `INVALID_REFRESH_TOKEN`. This prevents
concurrent requests from both rotating the same token. The service is designed
to support token-theft detection by revoking all sessions for a user when a
stale `jti` is presented, though the current implementation only rejects the
stale token.

The same per-IP rate-limit headers (`RateLimit`, `RateLimit-Policy`, and
`Retry-After` on 429) apply to this endpoint.

## Current user profile

`GET /api/v1/users/me` returns the authenticated current user's profile
(`email` and `displayName`). `PATCH /api/v1/users/me` updates the current
user's `displayName` and returns the full profile.

| Method  | Endpoint           | Result                              |
| ------- | ------------------ | ----------------------------------- |
| `GET`   | `/api/v1/users/me` | Get the current user profile; `200` |
| `PATCH` | `/api/v1/users/me` | Update the current user; `200`      |

`GET /api/v1/users/me` success `200`:

```json
{
  "email": "user@example.com",
  "displayName": null
}
```

`email` and `displayName` are nullable. The endpoint requires a valid Bearer
access token. Errors: `401 UNAUTHORIZED` (missing/invalid token),
`404 USER_NOT_FOUND` (the listening user no longer exists), and
`500 INTERNAL_SERVER_ERROR`.

`PATCH /api/v1/users/me` request body:

```json
{ "displayName": "Nguyen Minh Anh" }
```

`displayName` is a trimmed Unicode string of 1–100 characters, or `null` to
clear the stored value. The request body is strict and rejects unknown fields.

`PATCH` success `200`:

```json
{
  "id": "eb5d278f-c857-45c7-887d-7be65288cb75",
  "email": "user@example.com",
  "displayName": "Nguyen Minh Anh",
  "provider": "apple"
}
```

`email` and `displayName` are nullable. The endpoint requires a valid Bearer
access token. Errors: `400 VALIDATION_ERROR` (invalid body),
`401 UNAUTHORIZED` (missing/invalid token), `404 USER_NOT_FOUND` (the listening
user no longer exists), and `500 INTERNAL_SERVER_ERROR`.

## Offline mutation contract

The following authenticated creates require `Idempotency-Key`:

- `POST /api/v1/projects`
- `POST /api/v1/projects/:projectId/scans`
- `POST /api/v1/scans/:scanId/notes`
- `POST /api/v1/scans/:scanId/assets/upload-sessions`
- `POST /api/v1/projects/:projectId/invitations`

The key is trimmed, must contain 1–128 non-control characters, and is scoped by
authenticated user, operation, and concrete parent. Only a SHA-256 key hash is
stored. The canonical request hash excludes deprecated body aliases. A retry
with the same request replays the exact committed HTTP status and JSON body;
reuse with another validated payload returns
`409 IDEMPOTENCY_KEY_CONFLICT`. Validation, authorization, business failures,
and presign `503` failures do not claim the key. `clientMutationId` on Create
Scan and body `idempotencyKey` on Create Upload Session remain deprecated
aliases; when the header is also present the values must match. A legacy scan
key collision never restores a deleted scan. A missing key on Project, Scan,
Note, and Invitation creates returns `400 IDEMPOTENCY_KEY_REQUIRED`; a
malformed key (empty after trim, over 128 characters, or containing control
characters) returns `400 VALIDATION_ERROR`. Create Upload Session validates the
header through the `validateRequest` middleware with `IdempotencyKeyHeaderSchema`,
so a missing or malformed key returns `400 VALIDATION_ERROR` before the
deprecated body alias is reconciled.

Project, Scan, and Note single-resource responses include `revision` and return
the strong `ETag: "N"` header. Project PATCH/DELETE, Scan PATCH/DELETE, and Note
PATCH/move/DELETE require `If-Match: "N"`. Missing and malformed headers return
`400 REVISION_REQUIRED` and `400 INVALID_REVISION`. An atomic guarded write that
loses to a newer revision returns `409 REVISION_CONFLICT` with
`details.currentRevision` and `details.deleted`. Delete wins over stale update;
a stale mutation cannot clear any Project, Scan, or Note tombstone. Repeating a
completed Owner delete still returns `204`.

Revision roll-up is hierarchical: Note changes increment Note + Scan;
Scan and ScanAsset changes increment Scan; access lifecycle changes
increment ProjectAccess. Project rollups update `syncStatus` and
`lastSyncedAt` without incrementing the project revision, so optimistic
concurrency on the project resource is not invalidated by child mutations.
Acknowledging a conflict that leaves a project fully synced increments the
project revision, updates `lastSyncedAt`, and emits a project UPSERT sync
change so other clients observe the status transition. A fully synced project
updates `lastSyncedAt` after a successful mutation or conflict
acknowledgement; a project that becomes pending/syncing/failed keeps the
prior successful time.

## Sync

Both sync endpoints require Bearer authentication.

`GET /api/v1/sync/changes` accepts optional `since`, optional `cursor`, and
`limit` (default 100, maximum 500). `since` must be RFC3339 and is mutually
exclusive with `cursor`. Without either value the API freezes a sequence
watermark and returns the latest visible UPSERT for every active resource,
paged stably by resource type and ID. The returned opaque cursor continues that
snapshot and then switches the client to incremental sequence order. `since`
returns events whose `changedAt >= since` and also switches to a cursor.
Malformed, tampered, wrong-user, or ambiguous cursors return 400.

```json
{
  "changes": [
    {
      "resourceType": "NOTE",
      "resourceId": "b1a2c3d4-e5f6-4890-abcd-ef1234567890",
      "operation": "UPSERT",
      "revision": 3,
      "syncStatus": "SYNCED",
      "changedAt": "2026-08-17T04:00:00.000Z",
      "cursor": "opaque-user-bound-cursor",
      "deletedAt": null,
      "data": {
        "id": "b1a2c3d4-e5f6-4890-abcd-ef1234567890",
        "scanId": "f1e2d3c4-a5b6-7890-abcd-ef1234567890",
        "title": "Cabinet hinge",
        "content": "Cabinet hinge is loose"
      }
    }
  ],
  "nextCursor": "opaque-user-bound-cursor"
}
```

`resourceType` is `PROJECT | SCAN | NOTE | SCAN_ASSET | PROJECT_ACCESS`.
DELETE items always have `data: null` and a non-null `deletedAt`. Normalized
UPSERT data includes public identity/metadata and lifecycle timestamps, but
never storage keys, raw idempotency keys, presigned URLs, secrets, or internal
SQL fields. NOTE UPSERT data includes `title`, `content`, `color`,
`position`, `orientation`, and `modelVersion`. Owners receive their project
resources and access records. An
active Viewer receives project resources plus only their own access record. A
grant emits a targeted access UPSERT and current project bootstrap; revocation
emits a self-access tombstone, after which no later project event is visible to
that Viewer.

`GET /api/v1/sync/status` accepts optional `projectId` and always returns
`{ "items": [...] }`. Without it, results include every project the current user
owns (projects shared with them as a Viewer are not included, since a Viewer has
no upload/pending work to sync); with it, a non-owned or otherwise inaccessible
project is hidden as `404 PROJECT_NOT_FOUND`. Counts classify active scans by
required MODEL asset
lifecycle. `requiredAssetsUploaded` is true only when every active scan has an
UPLOADED MODEL; it is also true for zero scans. Status priority is `CONFLICT >
FAILED > SYNCING > PENDING > SYNCED`.

```json
{
  "items": [
    {
      "projectId": "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
      "syncStatus": "PENDING",
      "pendingCount": 1,
      "syncingCount": 0,
      "failedCount": 0,
      "conflictCount": 0,
      "lastSyncedAt": null,
      "requiredAssetsUploaded": false
    }
  ]
}
```

## Projects

Every project endpoint requires a valid Bearer access token in the
`Authorization` header. The token subject must still identify a database user.
The `ownerId` is derived from that current user and is never accepted from
clients.

| Method   | Endpoint                      | Result                                            |
| -------- | ----------------------------- | ------------------------------------------------- |
| `POST`   | `/api/v1/projects`            | Create an owned project; return `201`             |
| `GET`    | `/api/v1/projects`            | List projects owned by the current user           |
| `GET`    | `/api/v1/projects/:projectId` | Get detail as the Owner or an active Viewer       |
| `PATCH`  | `/api/v1/projects/:projectId` | Partially update as the Owner; return `200`       |
| `DELETE` | `/api/v1/projects/:projectId` | Soft-delete as the Owner; return idempotent `204` |

Project response:

```json
{
  "id": "eb5d278f-c857-45c7-887d-7be65288cb75",
  "name": "District 2 Apartment",
  "description": "Apartment survey",
  "owner": {
    "id": "8c53d31d-2788-48de-82a0-c4f219ca3701",
    "email": "owner@example.com",
    "displayName": null
  },
  "scanCount": 1,
  "scans": [
    {
      "id": "f1e2d3c4-a5b6-7890-abcd-ef1234567890",
      "name": "Living Room",
      "description": null,
      "thumbnail": null,
      "noteCount": 3,
      "assetStatus": "UPLOADED",
      "syncStatus": "SYNCED",
      "createdAt": "2026-07-29T10:00:00.000Z"
    }
  ],
  "sharedCount": 0,
  "thumbnail": null,
  "syncStatus": "SYNCED",
  "revision": 1,
  "lastSyncedAt": "2026-07-29T10:00:00.000Z",
  "createdAt": "2026-07-29T10:00:00.000Z",
  "updatedAt": "2026-07-29T10:00:00.000Z",
  "permissions": {
    "role": "OWNER",
    "canView": true,
    "canEdit": true,
    "canDelete": true,
    "canShare": true,
    "canCreateScan": true
  }
}
```

`owner.email` and `owner.displayName` are nullable. An active Viewer receives role `VIEWER` with only
`canView: true`. `sharedCount` counts active Viewer access records.
For the Owner, `scanCount` counts active (non-deleted) scans in the project and
`scans` lists those scans ordered by newest `createdAt` first. An active Viewer
sees only the scans that have successfully uploaded a model: for a Viewer,
`scanCount` counts only active scans with `assetStatus = UPLOADED` and `scans`
lists only those, so scans stuck in `PENDING`/`UPLOADING`/`FAILED`/`NONE` are
never exposed to a Viewer. Each listed scan carries `id`, `name`,
`description`, `thumbnail`, `noteCount`, `assetStatus`, `syncStatus`, and
`createdAt`. `thumbnail` remains nullable. Project `syncStatus` and
`lastSyncedAt` are persisted readiness fields; a new zero-scan project starts
`SYNCED`.

The owned-project list supports case-insensitive name search and page-based
pagination:

```http
GET /api/v1/projects?search=apartment&page=1&limit=5&sort=updatedAt:desc
```

```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "limit": 5,
    "total": 0,
    "totalPages": 0
  }
}
```

Blank `search` values are treated as absent. `page` defaults to 1; `limit`
defaults to 5 and may not exceed 100. `sort` defaults to `updatedAt:desc`.
Supported values are `updatedAt:desc`, `updatedAt:asc`, `createdAt:desc`,
`createdAt:asc`, `name:asc`, and `name:desc`. Every order uses `id` as its final
stable tie-breaker.

Validation rules:

- `projectId`: UUID.
- `name`: trimmed Unicode string, 1–50 characters; duplicate names are allowed.
- `description`: optional nullable string, maximum 500 characters.
- Create and update objects reject unknown fields.
- PATCH must contain at least one supported field.
- `"description": null` clears the stored description.
- Clients cannot submit `id`, `ownerId`, `createdAt`, or `updatedAt`.

Authorization and deletion rules:

- The Owner has full project control.
- An active Viewer may only read canonical project detail.
- Owned-project listing never includes Viewer-only or soft-deleted projects.
- Delete sets `deletedAt` and revokes active Viewer access in one transaction.
- Repeating delete as the same Owner returns `204`; other users receive the
  hidden not-found response.

Error behavior:

- `400 VALIDATION_ERROR`: invalid body, path parameters, or query parameters.
- `401 UNAUTHORIZED`: missing/invalid access token or missing current user.
- `404 PROJECT_NOT_FOUND`: project missing, deleted, revoked, or inaccessible.
- `429 RATE_LIMIT_EXCEEDED`: API quota exceeded.
- `500 INTERNAL_SERVER_ERROR`: unexpected failure without Prisma, SQL, or secret
  leakage.

## Scans

Every scan endpoint requires a valid Bearer access token. Scans belong to
exactly one project; the Owner (creator) has full control, and an active Viewer
may only read. Create and list are scoped under the parent project; detail,
update, and delete are scoped under the scan id.

| Method   | Endpoint                            | Result                                                             |
| -------- | ----------------------------------- | ------------------------------------------------------------------ |
| `POST`   | `/api/v1/projects/:projectId/scans` | Create scan metadata; Owner only; return `201` or idempotent `200` |
| `GET`    | `/api/v1/projects/:projectId/scans` | List scans; Owner or active Viewer; paginated                      |
| `GET`    | `/api/v1/scans/:scanId`             | Get scan detail; Owner or active Viewer                            |
| `PATCH`  | `/api/v1/scans/:scanId`             | Partially update name/description; Owner only                      |
| `DELETE` | `/api/v1/scans/:scanId`             | Soft-delete a scan; Owner only; idempotent `204`                   |

Scan response:

```json
{
  "id": "f1e2d3c4-a5b6-7890-abcd-ef1234567890",
  "projectId": "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
  "name": "Living Room",
  "description": null,
  "thumbnail": null,
  "creator": {
    "id": "eb5d278f-c857-45c7-887d-7be65288cb75",
    "email": "owner@example.com",
    "displayName": null
  },
  "noteCount": 0,
  "assetStatus": "NONE",
  "syncStatus": "PENDING",
  "modelVersion": 1,
  "revision": 1,
  "createdAt": "2026-07-29T10:00:00.000Z",
  "updatedAt": "2026-07-29T10:00:00.000Z",
  "permissions": {
    "role": "OWNER",
    "canView": true,
    "canEdit": true,
    "canDelete": true
  }
}
```

`creator.email` and `creator.displayName` are nullable. `noteCount` counts active notes attached to the
scan. `assetStatus` uses `NONE | PENDING | UPLOADING | UPLOADED | FAILED` and
starts `NONE` for a metadata-only scan; `syncStatus` uses `PENDING | SYNCING |
SYNCED | FAILED | CONFLICT` and starts `PENDING`. The metadata endpoints never
accept model-file bytes; the asset and sync status write path is the
responsibility of the scan-asset module.

Create Scan accepts optional `thumbnail` and `scanFile` upload descriptors. When
present, the API creates the scan and mints an upload session for each
descriptor, returning the scan plus `uploads`:

```json
{
  "id": "f1e2d3c4-a5b6-7890-abcd-ef1234567890",
  "projectId": "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
  "name": "Living Room",
  "thumbnail": null,
  "assetStatus": "NONE",
  "syncStatus": "PENDING",
  "modelVersion": 1,
  "revision": 1,
  "createdAt": "2026-07-29T10:00:00.000Z",
  "updatedAt": "2026-07-29T10:00:00.000Z",
  "permissions": {
    "role": "OWNER",
    "canView": true,
    "canEdit": true,
    "canDelete": true
  },
  "uploads": {
    "thumbnail": {
      "uploadSessionId": "c0ffee00-0000-4000-8000-000000000099",
      "assetId": "c0ffee00-0000-4000-8000-000000000099",
      "uploadUrl": "https://minio.example.com/bucket/scans/.../thumbnail?...",
      "uploadUrlExpiresAt": "2026-07-29T10:15:00.000Z"
    },
    "scanFile": {
      "uploadSessionId": "c0ffee00-0000-4000-8000-000000000100",
      "assetId": "c0ffee00-0000-4000-8000-000000000100",
      "uploadUrl": "https://minio.example.com/bucket/scans/.../model?...",
      "uploadUrlExpiresAt": "2026-07-29T10:15:00.000Z"
    }
  }
}
```

`creator` and `noteCount` are omitted above for brevity but are always present.
The `thumbnail` and `scanFile` descriptors are independent and optional: one
call may supply only `thumbnail`, only `scanFile`, or both, and each present
descriptor mints its own upload session and presigned `uploadUrl`. The client
uploads each file directly to its `uploadUrl` with a PUT, then calls the
completion endpoint for that session
(`POST /api/v1/upload-sessions/{uploadSessionId}/complete`); every minted
session is completed separately. Each `uploadUrl` is a presigned PUT URL with
the configured upload TTL; the model scan file must be between 0 MB and 200 MB.
A `thumbnail` descriptor requires `contentType` (`image/jpeg`, `image/png`) and
`sizeBytes` (`checksum` optional); a `scanFile` descriptor additionally requires
`checksum` and `modelVersion`. `uploads` is omitted when neither descriptor is
supplied.

The scan list supports page-based pagination and an allow-listed sort. `page`
defaults to 1; `limit` defaults to 20 and may not exceed 100. `sort` defaults to
`createdAt:desc`. Supported values are `createdAt:desc`, `createdAt:asc`,
`updatedAt:desc`, `updatedAt:asc`, `name:asc`, and `name:desc`. Every order uses
`id` as its final stable tie-breaker. When the current user is an active Viewer,
the list returns only scans with a successfully uploaded model
(`assetStatus = UPLOADED`) and the pagination totals reflect that filtered set,
so a Viewer never sees scans still pending upload here either.

Validation rules:

- `projectId` and `scanId`: UUID.
- `name` on create: required, trimmed Unicode string, 1–100 characters, not
  whitespace-only; duplicate names are allowed.
- `description`: optional nullable string, maximum 500 characters.
- `clientMutationId` on create: optional string, 1–128 characters; used for
  idempotent create and unique per project.
- `thumbnail` descriptor on create: optional; `contentType` must be
  `image/jpeg` or `image/png`, `sizeBytes` positive and at most the thumbnail
  maximum, `checksum` optional.
- `scanFile` descriptor on create: optional; `contentType` must be a supported
  model type (including `model/usdz`), `sizeBytes` positive and at most 200 MB,
  `checksum` and `modelVersion` required.
- Create and update objects reject unknown fields; PATCH must contain at least
  one supported field; `"description": null` clears the stored description.
- Clients cannot submit `id`, `projectId`, `createdById`, `createdAt`,
  `updatedAt`, `assetStatus`, `syncStatus`, or `modelVersion`.

Authorization and deletion rules:

- The Owner of the parent project has full scan control.
- An active Viewer may only read scan list and detail.
- Create with a reused active `clientMutationId` in the same project returns the
  existing scan with `200` instead of creating a duplicate.
- Reusing a `clientMutationId` that matches a soft-deleted scan in the same
  project returns `409 IDEMPOTENCY_KEY_CONFLICT`; it never restores the scan.
  A `clientMutationId` is unique per project, so the same value in a different
  project creates a new scan.
- Delete sets `deletedAt`, soft-deletes active notes/assets, emits descendant
  tombstones, and rolls up the parent project in one transaction.
- Repeating delete as the same Owner returns `204`; other users receive the
  hidden not-found response.

Error behavior:

- `400 VALIDATION_ERROR`: invalid body, path parameters, or query parameters.
- `401 UNAUTHORIZED`: missing/invalid access token or missing current user.
- `404 PROJECT_NOT_FOUND`: parent project missing, deleted, or inaccessible.
- `404 SCAN_NOT_FOUND`: scan missing, deleted, or inaccessible through its
  parent project.
- `429 RATE_LIMIT_EXCEEDED`: API quota exceeded.
- `500 INTERNAL_SERVER_ERROR`: unexpected failure without Prisma, SQL, or secret
  leakage.

## Scan assets

Every scan-asset endpoint requires a valid Bearer access token. A scan has at
most one model asset and one thumbnail asset (keyed by `assetType`). The project
Owner creates and completes uploads; the Owner and active Viewers can list
metadata and request download URLs. Revoked Viewers and access to
deleted projects/scans are hidden behind `404`.

| Method | Endpoint                                               | Result                                                          |
| ------ | ------------------------------------------------------ | --------------------------------------------------------------- |
| `POST` | `/api/v1/scans/:scanId/assets/upload-sessions`         | Create an upload session; Owner only; `201` or idempotent `200` |
| `POST` | `/api/v1/upload-sessions/:uploadSessionId/complete`    | Mark an upload session completed; Owner only; idempotent `200`  |
| `GET`  | `/api/v1/scans/:scanId/assets`                         | List asset metadata; Owner or active Viewer                     |
| `GET`  | `/api/v1/scans/:scanId/assets/:assetType/download-url` | Generate a download URL; Owner or active Viewer                 |
| `POST` | `/api/v1/upload-sessions/:uploadSessionId/fail`        | Report an upload failure; Owner only                            |

Create-session request:

- `assetType`: `MODEL` or `THUMBNAIL`.
- `contentType`: must be in the allowed list for the asset type (models
  `model/gltf-binary`, `model/gltf+json`, `application/octet-stream`,
  `model/usd`, `model/usdz`; thumbnails `image/jpeg`, `image/png`).
- `sizeBytes`: positive; for `MODEL` assets it must be at most the configured
  maximum (200 MB), and for
  `THUMBNAIL` assets at most the configured maximum (10 MB).
- `checksum` and `modelVersion`: required for `MODEL` assets.
- `Idempotency-Key` header: required. Body `idempotencyKey` is a deprecated
  alias and must match the header if both are sent. A repeated create with an
  active, unexpired session returns the original response without another
  active session.

Asset metadata response fields: `assetId`, `scanId`, `assetType`, `status`, and
for the download response `downloadUrl` plus `downloadUrlExpiresAt`. The target
object key is a `storageKey` persisted internally; the field is omitted from
responses, though the local provider's URLs embed the object key path.

Behavior and rules:

- Create and complete are Owner-only; list and download are Owner or active
  Viewer.
- Completed uploads are idempotent: repeating `complete` returns the stored
  asset without creating duplicates and, for a model, re-applies the parent scan
  status update so a retry recovers from an earlier failed scan update.
- A completed MODEL cannot be reset or overwritten directly; another session
  request returns `409 MODEL_ALREADY_COMPLETED`.
- Completed model uploads mark the scan `assetStatus = UPLOADED` and
  `syncStatus = SYNCED`; a reported failure marks the scan `FAILED`. Thumbnail
  completion leaves the scan status unchanged but persists a display URL onto
  the scan's `thumbnail` field (re-applied on a completed retry), so project and
  scan responses expose it.
- A download URL is only issued once an asset has status `UPLOADED`; otherwise
  the API returns `409 ASSET_NOT_READY`, and a missing asset record returns
  `404 ASSET_NOT_FOUND`.
- URLs carry the configured TTL as expiry metadata. The `local` provider mints
  unsigned URLs, does not persist bytes, and is restricted to non-production
  environments (`NODE_ENV=production` rejects `STORAGE_PROVIDER=local`). The
  `minio` provider mints presigned S3 URLs whose expiry is enforced by MinIO
  and, before completion, verifies that the uploaded object exists and that its
  stored size and content type exactly match the session's declared
  `contentType` and `sizeBytes`. The thumbnail display URL is a stable
  (non-expiring) object URL and therefore requires the bucket or objects to be
  publicly readable, or a CDN/reverse proxy in front of MinIO.

Error behavior:

- `400 VALIDATION_ERROR`: invalid assetType, content type, size, checksum,
  model version, or a missing/malformed `Idempotency-Key` header.
- `401 UNAUTHORIZED`: missing/invalid access token or missing current user.
- `404 SCAN_NOT_FOUND`: parent scan/project missing, deleted, or inaccessible.
- `404 ASSET_NOT_FOUND`: asset record missing or inaccessible.
- `409 ASSET_NOT_READY`: asset has not been uploaded yet.
- `409 UPLOAD_SESSION_EXPIRED`: upload session expired before completion.
- `409 ASSET_UPLOAD_FAILED`: the uploaded object is missing or its stored size
  or content type does not match the session.
- `503 STORAGE_UNAVAILABLE`: the storage provider is unavailable.
- `429 RATE_LIMIT_EXCEEDED`: API quota exceeded.
- `500 INTERNAL_SERVER_ERROR`: unexpected failure without Prisma, SQL, or secret
  leakage.

## Notes

Every note endpoint requires a valid Bearer access token. Notes belong to
exactly one scan; the project Owner creates, edits, moves, and deletes notes,
and the Owner and active Viewers can list and read them. Deleted or
inaccessible scans, projects, and notes are hidden behind `404`.

| Method   | Endpoint                         | Result                                                   |
| -------- | -------------------------------- | -------------------------------------------------------- |
| `POST`   | `/api/v1/scans/:scanId/notes`    | Create a note on a scan; Owner only; return `201`        |
| `GET`    | `/api/v1/scans/:scanId/notes`    | List notes for a scan; Owner or active Viewer; paginated |
| `GET`    | `/api/v1/notes/:noteId`          | Get note detail; Owner or active Viewer                  |
| `PATCH`  | `/api/v1/notes/:noteId`          | Update note title, content, or color; Owner only         |
| `PATCH`  | `/api/v1/notes/:noteId/position` | Move a note to a new 3D position; Owner only             |
| `DELETE` | `/api/v1/notes/:noteId`          | Delete a note; Owner only; return `204`                  |

Note response:

```json
{
  "id": "b1a2c3d4-e5f6-4890-abcd-ef1234567890",
  "scanId": "f1e2d3c4-a5b6-7890-abcd-ef1234567890",
  "title": "Cabinet hinge",
  "content": "Cabinet hinge is loose",
  "color": "YELLOW",
  "position": { "x": 1.5, "y": -2, "z": 3.25 },
  "orientation": { "x": 0, "y": 0, "z": 1 },
  "modelVersion": "1",
  "revision": 1,
  "creator": {
    "id": "eb5d278f-c857-45c7-887d-7be65288cb75",
    "email": "owner@example.com",
    "displayName": null
  },
  "createdAt": "2026-07-29T10:00:00.000Z",
  "updatedAt": "2026-07-29T10:00:00.000Z",
  "permissions": {
    "role": "OWNER",
    "canView": true,
    "canEdit": true,
    "canDelete": true
  }
}
```

`position` is a required `{ x, y, z }` vector stored relative to the scan model,
not the current camera angle. `orientation` is an optional `{ x, y, z }` vector.
`modelVersion` is a string that must match the parent scan's model version;
creating or moving a note with a different version returns `409`.

The note list supports page-based pagination and an allow-listed sort. `page`
defaults to 1; `limit` defaults to 20 and may not exceed 100. `sort` defaults to
`updatedAt:desc`. Supported values are `updatedAt:desc`, `updatedAt:asc`,
`createdAt:desc`, and `createdAt:asc`. Every order uses `id` as its final stable
tie-breaker.

Validation rules:

- `scanId` and `noteId`: UUID.
- `title` on create: required, trimmed Unicode string, 1–50 characters, not
  whitespace-only; on update it is optional with the same bounds.
- `content` on create: required, trimmed Unicode string, 1–2000 characters, not
  whitespace-only; on update it is optional with the same bounds.
- `color`: one of `YELLOW`, `RED`, `BLUE`, `GREEN`, `ORANGE`, `PURPLE`, `CYAN`,
  `GRAY`.
- `position`: object with numeric `x`, `y`, and `z`.
- `orientation`: optional nullable object with numeric `x`, `y`, and `z`.
- `modelVersion` on create and on move: required string, 1–64 characters, and
  must equal the parent scan's current model version.
- Create, update, and move objects reject unknown fields; update must contain at
  least one supported field.
- Clients cannot submit `id`, `scanId`, `createdById`, `createdAt`, or
  `updatedAt`.

Authorization and behavior rules:

- The Owner of the parent project creates, edits, moves, and deletes notes.
- An active Viewer may only read note list and detail.
- Note content is never written to logs; unexpected failures return the standard
  error envelope without echoing note text.
- Creating, updating, moving, or deleting a note touches the parent scan and
  project `updatedAt` in the same transaction.
- A note cannot exist outside a scan. Deleting a scan or project makes its notes
  inaccessible: scan endpoints filter notes on the non-deleted scan, and the
  `notes` foreign key cascades when a scan row is physically removed.
- Deleting a note sets `deletedAt`, increments its revision, writes a tombstone,
  and returns `204`; stale updates cannot restore it.

Error behavior:

- `400 VALIDATION_ERROR`: invalid body, path parameters, or query parameters.
- `401 UNAUTHORIZED`: missing/invalid access token or missing current user.
- `404 SCAN_NOT_FOUND`: parent scan missing, deleted, or inaccessible.
- `404 NOTE_NOT_FOUND`: note missing, deleted, or inaccessible through its
  parent scan.
- `409 MODEL_VERSION_MISMATCH`: submitted model version differs from the scan's
  current model version.
- `429 RATE_LIMIT_EXCEEDED`: API quota exceeded.
- `500 INTERNAL_SERVER_ERROR`: unexpected failure without Prisma, SQL, note
  content, or secret leakage.

## Sharing and invitations

Projects and scans are shared through expiring, token-based links. There are two
kinds of shareable links:

- **Per-recipient invitations** addressed to a specific recipient email. The
  Owner creates an invitation, and the API sends an invitation email whose CTA
  opens the link; the recipient (or any signed-in user who possesses the link)
  accepts it and receives Viewer access. Each invitation is per-recipient:
  creating a second invitation for the same email and scope while the first is
  still pending returns `409 INVITATION_ALREADY_SENT`.
- **Generic share links** with no recipient. Copying the link does not send an
  email; any signed-in user with the link can accept it and receive Viewer
  access. A share link is reusable and stays valid until it expires or the Owner
  revokes it, so multiple users can accept the same link.

The raw token is an opaque, random base64url string of 32 bytes; only its
SHA-256 hash is stored, so a leaked database never exposes a usable link. The
token is also redacted from request access logs so it is never emitted to log
shippers. A project is shareable only when it has at least one non-deleted scan
with an uploaded model (`assetStatus = UPLOADED`); a scan is shareable only when
that specific scan has an uploaded model. Every invitation and share link has
exactly one scope: a project (`projectId`) or a scan (`scanId`). Acceptance
creates a `ProjectAccess` row for project scope or a `ScanAccess` row for scan
scope, and `ScanAccess` records grant read access to that scan, its notes, and
its assets without granting project-level access.

| Method   | Endpoint                                               | Result                                                            |
| -------- | ------------------------------------------------------ | ----------------------------------------------------------------- |
| `POST`   | `/api/v1/projects/:projectId/invitations`              | Create a project invitation for an email; Owner only; `201`       |
| `POST`   | `/api/v1/scans/:scanId/invitations`                    | Create a scan invitation for an email; Owner only; `201`          |
| `POST`   | `/api/v1/invitations/:invitationId/resend`             | Resend a pending invitation; Owner only; `200`                    |
| `GET`    | `/api/v1/invitations/:token`                           | Preview an invitation or share link; requires authentication      |
| `POST`   | `/api/v1/invitations/:token/accept`                    | Accept and gain Viewer access; `200`                              |
| `POST`   | `/api/v1/invitations/:token/decline`                   | Decline an invitation for the current user; `200`                 |
| `DELETE` | `/api/v1/invitations/:invitationId`                    | Revoke a pending or expired invitation; Owner only; `200`         |
| `GET`    | `/api/v1/projects/:projectId/shares`                   | List project pending invitations and accepted Viewers; Owner only |
| `DELETE` | `/api/v1/projects/:projectId/shares/:userId`           | Revoke project Viewer access; Owner only; `200`                   |
| `GET`    | `/api/v1/scans/:scanId/shares`                         | List scan pending invitations and accepted Viewers; Owner only    |
| `DELETE` | `/api/v1/scans/:scanId/shares/:userId`                 | Revoke scan Viewer access; Owner only; `200`                      |
| `POST`   | `/api/v1/projects/:projectId/share-links`              | Create a reusable project share link; Owner only; `201`           |
| `GET`    | `/api/v1/projects/:projectId/share-links`              | List active project share links; Owner only; `200`                |
| `DELETE` | `/api/v1/projects/:projectId/share-links/:shareLinkId` | Revoke a project share link; Owner only; `200`                    |
| `POST`   | `/api/v1/scans/:scanId/share-links`                    | Create a reusable scan share link; Owner only; `201`              |
| `GET`    | `/api/v1/scans/:scanId/share-links`                    | List active scan share links; Owner only; `200`                   |
| `DELETE` | `/api/v1/scans/:scanId/share-links/:shareLinkId`       | Revoke a scan share link; Owner only; `200`                       |

Create invitation body:

```json
{ "recipientEmail": "recipient@example.com", "expiresInSeconds": 604800 }
```

`recipientEmail` is required. `expiresInSeconds` is optional; it defaults to the
configured `INVITATION_TTL_SECONDS` and must be between 60 and 2,592,000 (30
days). Create response `201`:

```json
{
  "invitationId": "b1a2c3d4-e5f6-4890-abcd-ef1234567890",
  "invitationUrl": "https://invite.roomscan.dev/invitations/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab?scope=project",
  "recipientEmail": "recipient@example.com",
  "expiresAt": "2026-08-05T10:00:00.000Z",
  "status": "PENDING",
  "sentAt": "2026-07-29T10:00:00.000Z"
}
```

`invitationUrl` is `{INVITATION_BASE_URL}/invitations/{rawToken}?scope={scope}`,
where `scope` is `project` or `scan`. The `scope` query parameter is an
informational hint only that lets a client (such as the mobile universal-link
parser) know whether the link targets a project or a scan before it previews the
token; it is never trusted server-side, and the preview, accept, and decline
endpoints always resolve the scope from the token. Creating the invitation
sends an AC5-style invitation email to `recipientEmail`; a mail delivery failure
is logged and does not fail the request.

Resend `200` has the same shape as the create response. Resending a pending
invitation rotates the token (the previous link stops working), extends
`expiresAt` to `now + INVITATION_TTL_SECONDS`, updates `sentAt`, and re-sends
the email.

Preview `200` resolves either an invitation or a generic share link and returns
a `type` (`invitation` or `share-link`) and `scope` (`project` or `scan`) plus
the matching entity (`project` or `scan`); the other entity is `null`. An
invitation adds `sentAt` and its lifecycle `status`; a share link has no
recipient and reports `ACTIVE`, `EXPIRED`, or `REVOKED`. The preview endpoint
requires a valid Bearer access token. The invitation `recipientEmail` is always
submitted, and `hasAccess` reports whether that user already has active access. A
project-scope invitation preview:

```json
{
  "type": "invitation",
  "scope": "project",
  "project": {
    "id": "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
    "name": "District 2 Apartment",
    "description": null,
    "thumbnail": null,
    "owner": {
      "id": "eb5d278f-c857-45c7-887d-7be65288cb75",
      "email": "owner@example.com",
      "displayName": null
    },
    "scanCount": 4
  },
  "scan": null,
  "status": "PENDING",
  "recipientEmail": "recipient@example.com",
  "sentAt": "2026-07-29T10:00:00.000Z",
  "expiresAt": "2026-08-05T10:00:00.000Z",
  "hasAccess": false
}
```

For a project-scope link, `project` includes the Owner info (`owner.id`, nullable
`owner.email` and `owner.displayName`), `scanCount` (number of active scans that
have successfully uploaded a model, i.e. `assetStatus = UPLOADED` — scans still
pending upload are not counted so the accept-invite screen shows only what the
Viewer will actually see), and `thumbnail`
set to the thumbnail of the project's most recently created uploaded scan (nullable). The
`owner` and `scanCount` fields are always present for a project-scope link and are
absent for a scan-scope link, where `project` is `null`.

For a scan-scope link, `scan` includes `id`, `projectId`, `name`, `description`,
`thumbnail`, `creator` (the parent project Owner: `id`, nullable `email`, and
nullable `displayName`), and
`noteCount` (number of active notes on the scan). `project` is `null` for a
scan-scope link.

`status` is `PENDING`, `EXPIRED`, `ACCEPTED`, or `DECLINED` for invitation
previews and `ACTIVE` or `EXPIRED` for share-link previews. When the source was
revoked or deleted before the Viewer previews, accepts, or declines, preview,
accept, and decline instead return `404 SHARE_NO_LONGER_AVAILABLE` with the
message "This project/scan is no longer available." An unknown token or one that
resolves to no record returns `404 INVITATION_NOT_FOUND` (or
`SHARE_LINK_NOT_FOUND` for share links).

Per-recipient invitations are restricted to the invited recipient: when the
current user's email does not match the invited email (case-insensitive,
null-safe), preview, accept, or decline returns `403 INVITATION_NOT_FOR_USER`
with the message "You do not have permission to access this item." Generic share
links (which have no recipient) are not subject to this check.

Accept `200` also discriminates on `type` and `scope` and returns the matching
entity. A project-scope invitation accept:

```json
{
  "type": "invitation",
  "invitationId": "b1a2c3d4-e5f6-4890-abcd-ef1234567890",
  "scope": "project",
  "project": {
    "id": "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
    "name": "District 2 Apartment",
    "description": null,
    "thumbnail": null,
    "owner": {
      "id": "eb5d278f-c857-45c7-887d-7be65288cb75",
      "email": "owner@example.com",
      "displayName": null
    }
  },
  "scan": null,
  "access": {
    "role": "VIEWER",
    "status": "ACTIVE",
    "grantedAt": "2026-07-29T10:00:00.000Z"
  }
}
```

A scan-scope accept returns the scan entity (`id`, `projectId`, `name`,
`description`, `thumbnail`, `noteCount`, `creator`, `ownerId`) with `project` set
to `null`, and a share-link accept reports `shareLinkId` instead of `invitationId`.

Decline `200`:

```json
{
  "invitationId": "b1a2c3d4-e5f6-4890-abcd-ef1234567890",
  "status": "DECLINED",
  "declinedAt": "2026-07-29T10:00:00.000Z"
}
```

Revoke invitation `200`:

```json
{
  "invitationId": "b1a2c3d4-e5f6-4890-abcd-ef1234567890",
  "status": "REVOKED",
  "revokedAt": "2026-07-29T10:00:00.000Z"
}
```

List shares `200`:

```json
{
  "pendingInvitations": [
    {
      "invitationId": "b1a2c3d4-e5f6-4890-abcd-ef1234567890",
      "recipientEmail": "recipient@example.com",
      "status": "PENDING",
      "sentAt": "2026-07-29T10:00:00.000Z",
      "expiresAt": "2026-08-05T10:00:00.000Z"
    }
  ],
  "viewers": [
    {
      "userId": "f1a2b3c4-d5e6-7890-abcd-ef1234567890",
      "revision": 1,
      "recipientUser": {
        "id": "f1a2b3c4-d5e6-7890-abcd-ef1234567890",
        "email": "recipient@example.com",
        "displayName": null
      },
      "grantedAt": "2026-07-29T10:00:00.000Z"
    }
  ]
}
```

`pendingInvitations` includes every `PENDING` invitation (labelled `EXPIRED`
once past `expiresAt`) so the owner can still revoke or resend stale links.
`viewers` lists active (`revokedAt` null) Viewer access records with the
recipient, current access revision, and the date access was granted.

Revoke Viewer access `200`:

```json
{
  "projectId": "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
  "userId": "f1a2b3c4-d5e6-7890-abcd-ef1234567890",
  "revision": 2,
  "revokedAt": "2026-07-29T10:00:00.000Z"
}
```

Validation rules:

- `projectId`, `userId`, `invitationId`: UUID.
- `recipientEmail`: a valid email address.
- `token`: exactly 43 characters from the base64url alphabet; anything else is
  malformed.
- `expiresInSeconds`: optional integer, 60 to 2,592,000; unknown fields are
  rejected.

Business rules:

- Only the project Owner creates invitations and manages shares; a non-owner
  receives `403 NOT_OWNER`. Viewers cannot share a project or scan again. The
  Owner of a scan is the owner of its parent project.
- Invitation and share-link acceptance grant Viewer role only.
- A project is shareable only after it has at least one uploaded scan model; a
  scan is shareable only after that scan has an uploaded model.
- One pending invitation per `(project, recipientEmail)` and per
  `(scan, recipientEmail)`: creating a duplicate returns `409
INVITATION_ALREADY_SENT`. Re-inviting an email whose earlier invitation is
  revoked, declined, accepted, or expired creates a fresh invitation. Partial
  unique indexes on `(projectId, recipientEmail)` and `(scanId, recipientEmail)`
  for `PENDING` rows make creation atomic, so concurrent duplicates resolve to
  `409` instead of creating a second pending link.
- Invitations are per-recipient: the first acceptance marks the invitation
  `ACCEPTED`; an already accepted or declined invitation cannot be accepted
  again. Previewing, accepting, or declining a per-recipient invitation requires
  the current user's email to match the invited email; otherwise the endpoint
  returns `403 INVITATION_NOT_FOR_USER`.
- An invitation can be revoked while pending or expired; revocation is
  idempotent. Revoking an expired invitation lets the owner clean up a stale link
  and returns the normal revoke `200` instead of `409 INVITATION_EXPIRED`.
  Accepted and declined invitations cannot be revoked.
- Resend requires a pending, unexpired invitation; it rotates the token and
  re-sends the email. Resend works for both project and scan invitations and
  uses the matching email template.
- Expired and revoked invitations cannot be accepted or declined. Previewing,
  accepting, or declining a revoked invitation or share link, or one whose
  project or scan was deleted, returns `404 SHARE_NO_LONGER_AVAILABLE`.
- A generic share link has no recipient and no `ACCEPTED`/`DECLINED` lifecycle;
  acceptance creates access without changing the link, so it remains usable by
  other users until it expires or the Owner revokes it. Revoking a link stops
  further acceptances but does not revoke access already granted through it.
- Accepting must not create duplicate Viewer access: at most one access record
  exists per `(project, user)` and per `(scan, user)`.
- The project Owner cannot accept or decline their own invitation, nor accept
  their own share link.
- A user who already has active access to the entity cannot accept or decline
  again.
- Revoking a project Viewer removes project, scan, note, and asset download
  access immediately; revoking a scan Viewer removes access to that scan, its
  notes, and its assets, because every module's permission lookup ignores
  `revokedAt`-non-null access. Scan-level access lets a Viewer read only that
  scan (plus its notes and assets); it never grants project, other-scan, or
  write access.

Share-link create `201`:

```json
{
  "shareLinkId": "c0ffee00-0000-4000-8000-0000000000aa",
  "shareLinkUrl": "https://invite.roomscan.dev/invitations/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab?scope=project",
  "scope": "project",
  "expiresAt": "2026-08-05T10:00:00.000Z"
}
```

The share link list returns `{ "items": [{ "shareLinkId", "status": "ACTIVE",
"expiresAt", "createdAt" }] }`; revoked and expired links are omitted. Revoking
a share link returns `{ "shareLinkId", "status": "REVOKED", "revokedAt" }` and
is idempotent. `shareLinkUrl` is `{INVITATION_BASE_URL}/invitations/{rawToken}?scope={scope}`
(the same scope hint as invitations, where `scope` is `project` or `scan`, used
only as a client-side hint and never trusted server-side), and shares the same
token namespace as invitations.

Validation rules:

- `projectId`, `scanId`, `userId`, `invitationId`, `shareLinkId`: UUID.
- `recipientEmail`: a valid email address.
- `token`: exactly 43 characters from the base64url alphabet; anything else is
  malformed.
- `expiresInSeconds`: optional integer, 60 to 2,592,000; unknown fields are
  rejected.

Error behavior:

- `400 VALIDATION_ERROR`: malformed token, invalid body, or invalid path/query.
- `401 UNAUTHORIZED`: missing/invalid access token where authentication is
  required (preview, accept, decline, and all Owner-only endpoints).
- `403 NOT_OWNER`: a non-owner attempts share management.
- `403 INVITATION_NOT_FOR_USER`: an authenticated user's email does not match the
  invited email (per-recipient invitations only); the caller lacks permission.
- `404 PROJECT_NOT_FOUND`: project missing, deleted, or inaccessible.
- `404 SCAN_NOT_FOUND`: scan missing, deleted, or inaccessible.
- `404 INVITATION_NOT_FOUND`: unknown token or invitation, or the invitation's
  project or scan was deleted.
- `404 SHARE_LINK_NOT_FOUND`: unknown share-link token or id, or its resource
  was deleted.
- `404 SHARE_NO_LONGER_AVAILABLE`: the shared project or scan was revoked or
  deleted before the current user previewed, accepted, or declined it; the link
  is unusable.
- `404 ACCESS_NOT_FOUND`: no access record exists for the user being unshared.
- `409 INVITATION_ALREADY_SENT`: a pending invitation already targets this email.
- `409 INVITATION_ALREADY_ACCEPTED`: the invitation was already accepted.
- `409 INVITATION_EXPIRED`: the link is past its expiry.
- `409 INVITATION_REVOKED`: the link was revoked.
- `409 INVITATION_DECLINED`: the user already declined this link.
- `409 ACCESS_ALREADY_EXISTS`: the user already has active access.
- `409 CANNOT_ACCEPT_OWN_INVITATION`: the resource Owner acts on their own link.
- `409 PROJECT_NOT_SHAREABLE`: the project has no uploaded scan model yet.
- `409 SCAN_NOT_SHAREABLE`: the scan has no uploaded model yet.
- `409 SHARE_LINK_EXPIRED`: the share link is past its expiry.
- `429 RATE_LIMIT_EXCEEDED`: API quota exceeded.
- `500 INTERNAL_SERVER_ERROR`: unexpected failure without Prisma, SQL, token, or
  secret leakage.

## Shared With Me

Every Shared With Me endpoint requires a valid Bearer access token. The list
result is every non-deleted project the current user accepted an invitation
for — the access row's own `deletedAt` is unset — each with a computed
`status`; projects owned by the current user never appear. Removing a
project marks only the current user's own access row as removed (a separate
`deletedAt`, distinct from the Owner's `revokedAt`), so the original project,
the Owner, and other Viewers are never affected.

| Method   | Endpoint                             | Result                                                |
| -------- | ------------------------------------ | ----------------------------------------------------- |
| `GET`    | `/api/v1/shared-projects`            | List projects shared with the current user; paginated |
| `GET`    | `/api/v1/shared-projects/:projectId` | Get shared project detail; active Viewer only         |
| `DELETE` | `/api/v1/shared-projects/:projectId` | Remove a project from the current user's list         |

Shared project item (list and detail share the same shape, except the detail also
returns `scans`):

```json
{
  "id": "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
  "name": "District 2 Apartment",
  "description": null,
  "owner": {
    "id": "eb5d278f-c857-45c7-887d-7be65288cb75",
    "email": "owner@example.com",
    "displayName": null
  },
  "scanCount": 4,
  "thumbnail": null,
  "updatedAt": "2026-07-29T10:00:00.000Z",
  "status": "ACTIVE",
  "permissions": {
    "role": "VIEWER",
    "canView": true,
    "canEdit": false,
    "canDelete": false,
    "canShare": false,
    "canCreateScan": false
  }
}
```

`GET /api/v1/shared-projects/:projectId` additionally returns the project's
active scans that have successfully uploaded a model (`assetStatus = UPLOADED`),
ordered by newest `createdAt` first, with the same `scans` array
shape (`id`, `name`, `description`, `thumbnail`, `noteCount`, `assetStatus`,
`syncStatus`, `createdAt`) as the canonical project detail. Scans still pending
upload are never returned to the Viewer. The Shared With Me
list response omits `scans` to keep each list item lightweight.

`owner.email` and `owner.displayName` are nullable. `scanCount` counts active
scans in the project that have successfully uploaded a model (`assetStatus =
UPLOADED`); scans still pending upload are not counted for the Viewer.
`thumbnail` is `null` until the thumbnail persistence feature is
present. `permissions` is always `VIEWER` and read-only; `canView` is `true`
only while the project is `ACTIVE`. `status` is one of:

- `ACTIVE`: the access row is active and the project is not deleted; the project
  can be opened.
- `REVOKED`: the Owner revoked the Viewer; the project cannot be opened.
- `PROJECT_DELETED`: the project was soft-deleted and its access rows were
  revoked; the project cannot be opened.
- `TEMPORARILY_UNAVAILABLE`: a defensive state for an inconsistent access record
  (for example a deleted project whose access row is still active); the project
  cannot be opened.

The list supports case-insensitive name search and page-based pagination:

```http
GET /api/v1/shared-projects?search=apartment&page=1&limit=5&sort=updatedAt:desc
```

```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "limit": 5,
    "total": 0,
    "totalPages": 0
  }
}
```

Blank `search` values are treated as absent. `page` defaults to 1; `limit`
defaults to 5 and may not exceed 100. `sort` defaults to `updatedAt:desc`.
Supported values are the same allow-list as owned projects (`updatedAt`, `createdAt`,
and `name`, each `:asc` or `:desc`), and every order uses the project `id` as its
final stable tie-breaker.

Detail `200` returns a shared project only while its status is `ACTIVE`;
revoked, deleted, and never-shared projects are hidden behind
`404 PROJECT_NOT_FOUND`.

Remove `200`:

```json
{
  "projectId": "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
  "removedAt": "2026-07-29T10:00:00.000Z"
}
```

Validation rules:

- `projectId`: UUID.
- `search`: optional trimmed string, maximum 50 characters; blank treated as
  absent.
- `page` and `limit`: positive integers, `limit` at most 100.
- `sort`: allow-listed values only; unknown values are rejected.

Business rules:

- Shared With Me lists projects accepted by the current user; owned projects
  never appear, so the Owner of a project cannot open or remove it here.
- An active Viewer can open a shared project read-only. Deeper navigation
  (scans, notes, assets) uses the canonical project and scan endpoints, which
  already authorize active Viewers by requiring both `revokedAt` and
  `deletedAt` unset on the access row.
- Revoking a Viewer (Owner action) or deleting the project leaves the entry in
  the Viewer's list with `status` `REVOKED` or `PROJECT_DELETED`, but the
  project can no longer be opened.
- Removing a project is a Viewer-only self-service action: it sets `deletedAt`
  on the current user's access row only, never the Owner's project, and never
  other Viewers' access. It works regardless of the current status (including an
  Owner-revoked entry) and is idempotent: repeating it on an already-removed
  entry returns `200` with the stored `removedAt`. Once removed, the project no
  longer appears in the Viewer's list. The access revision, Owner event, and
  targeted self-access tombstone commit in the same transaction.
- Removing an entry the current user never had access to, or that is owned by
  the current user, returns an error; an empty/absent access row for a
  non-owner returns `409`.

Error behavior:

- `400 VALIDATION_ERROR`: invalid path or query parameters.
- `401 UNAUTHORIZED`: missing/invalid access token or missing current user.
- `403 NOT_SHARED_PROJECT`: the current user owns the project, so it can never be
  in their Shared With Me list (removal only).
- `404 PROJECT_NOT_FOUND`: the project is missing, revoked, deleted, or
  inaccessible to the current user (detail only).
- `409 NOT_IN_SHARED_WITH_ME`: the project is not in the current user's Shared
  With Me list (removal only).
- `429 RATE_LIMIT_EXCEEDED`: API quota exceeded.
- `500 INTERNAL_SERVER_ERROR`: unexpected failure without Prisma, SQL, or secret
  leakage.

## Shared Scans

Every Shared Scans endpoint requires a valid Bearer access token and mirrors the
project-level Shared With Me surface, but at scan granularity. The list result
is every non-deleted scan the current user accepted a scan-level invitation or
share link for — the access row's own `deletedAt` is unset — each with a
computed `status`; scans owned by the current user never appear.
Removing a scan marks only the current user's own `scan_accesses` row as removed
(a separate `deletedAt`, distinct from the Owner's `revokedAt`): the original
scan, the Owner, and other Viewers are never affected.

| Method   | Endpoint                       | Result                                             |
| -------- | ------------------------------ | -------------------------------------------------- |
| `GET`    | `/api/v1/shared-scans`         | List scans shared with the current user; paginated |
| `GET`    | `/api/v1/shared-scans/:scanId` | Get shared scan detail; active Viewer only         |
| `DELETE` | `/api/v1/shared-scans/:scanId` | Remove a scan from the current user's list         |

Shared scan item (list and detail share the same shape):

```json
{
  "id": "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
  "projectId": "11111111-2222-4333-8444-555555555555",
  "project": {
    "id": "11111111-2222-4333-8444-555555555555",
    "name": "District 2 Apartment"
  },
  "name": "Living Room Scan",
  "description": null,
  "thumbnail": null,
  "creator": {
    "id": "eb5d278f-c857-45c7-887d-7be65288cb75",
    "email": "owner@example.com",
    "displayName": null
  },
  "noteCount": 4,
  "assetStatus": "UPLOADED",
  "syncStatus": "SYNCED",
  "modelVersion": 1,
  "updatedAt": "2026-07-29T10:00:00.000Z",
  "status": "ACTIVE",
  "permissions": {
    "role": "VIEWER",
    "canView": true,
    "canEdit": false,
    "canDelete": false
  }
}
```

`creator.email` and `creator.displayName` are nullable. `noteCount` counts active notes on the scan.
`project` carries the parent project's `id` and `name` and is always present and
non-nullable, because a scan cannot exist without its project. It is included
deliberately: scan-level sharing grants no `ProjectAccess`, so a Viewer here
cannot call `GET /api/v1/projects/:projectId` (it answers
`404 PROJECT_NOT_FOUND`) and would otherwise hold a `projectId` it can never
resolve to a name. Sharing a scan therefore also discloses the parent project's
name to that Viewer. `projectId` is retained alongside `project.id` for
backward compatibility. `permissions`
is always `VIEWER` and read-only; `canView` is `true` only while the scan is
`ACTIVE`. `status` is one of:

- `ACTIVE`: the access row is active and the scan is not deleted; the scan can
  be opened.
- `REVOKED`: the Owner revoked the Viewer; the scan cannot be opened.
- `SCAN_DELETED`: the scan was soft-deleted and its access rows were revoked;
  the scan cannot be opened.
- `TEMPORARILY_UNAVAILABLE`: a defensive state for an inconsistent access record
  (for example a deleted scan whose access row is still active); the scan cannot
  be opened.

The list supports case-insensitive name search and page-based pagination:

```http
GET /api/v1/shared-scans?search=living&page=1&limit=5&sort=updatedAt:desc
```

```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "limit": 5,
    "total": 0,
    "totalPages": 0
  }
}
```

Blank `search` values are treated as absent. `page` defaults to 1; `limit`
defaults to 5 and may not exceed 100. `sort` defaults to `updatedAt:desc`.
Supported values are the same allow-list as owned scans (`updatedAt`, `createdAt`,
and `name`, each `:asc` or `:desc`), and every order uses the scan `id` as its
final stable tie-breaker.

Detail `200` returns a shared scan only while its status is `ACTIVE`; revoked,
deleted, and never-shared scans are hidden behind `404 SCAN_NOT_FOUND`.

Remove `200`:

```json
{
  "scanId": "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
  "removedAt": "2026-07-29T10:00:00.000Z"
}
```

Validation rules:

- `scanId`: UUID.
- `search`: optional trimmed string, maximum 50 characters; blank treated as
  absent.
- `page` and `limit`: positive integers, `limit` at most 100.
- `sort`: allow-listed values only; unknown values are rejected.

Business rules:

- Shared Scans lists scans accepted by the current user; scans owned by the
  current user never appear, so the Owner of a scan cannot open or remove it
  here.
- An active Viewer can open a shared scan read-only. Deeper navigation (notes,
  assets) uses the canonical scan endpoints, which already authorize active
  Viewers by requiring both `revokedAt` and `deletedAt` unset on the access
  row.
- Revoking a Viewer (Owner action) or deleting the scan leaves the entry in the
  Viewer's list with `status` `REVOKED` or `SCAN_DELETED`, but the scan can no
  longer be opened.
- Removing a scan is a Viewer-only self-service action: it sets `deletedAt` on
  the current user's `scan_accesses` row only, never the Owner's scan, and never
  other Viewers' access. It works regardless of the current status (including an
  Owner-revoked entry) and is idempotent: repeating it on an already-removed
  entry returns `200` with the stored `removedAt`. Once removed, the scan no
  longer appears in the Viewer's list.
- Removing an entry the current user never had access to, or that is owned by
  the current user, returns an error; an empty/absent access row for a
  non-owner returns `409`.

Error behavior:

- `400 VALIDATION_ERROR`: invalid path or query parameters.
- `401 UNAUTHORIZED`: missing/invalid access token or missing current user.
- `403 NOT_SHARED_SCAN`: the current user owns the scan, so it can never be in
  their Shared With Me list (removal only).
- `404 SCAN_NOT_FOUND`: the scan is missing, revoked, deleted, or inaccessible
  to the current user (detail only).
- `409 NOT_IN_SHARED_WITH_ME`: the scan is not in the current user's Shared With
  Me list (removal only).
- `429 RATE_LIMIT_EXCEEDED`: API quota exceeded.
- `500 INTERNAL_SERVER_ERROR`: unexpected failure without Prisma, SQL, or secret
  leakage.

## Health semantics

Liveness proves only that the HTTP process can respond. Readiness may query
required dependencies and must return 503 when PostgreSQL is unavailable.

## API change gate

Any public HTTP change must update all affected artifacts in the same branch:

1. Runtime Zod request and response schemas.
2. Route implementation and expected error handling.
3. OpenAPI registry entries exposed through `/api-doc.json`.
4. Unit/API tests for success, validation, and expected failure paths.
5. This document when conventions or shared behavior change.
6. The root `README.md` when public endpoints, environment, or operator-visible
   behavior change.

Do not hand off an API change while Swagger, tests, and implementation describe
different contracts. Follow the
[documentation synchronization policy](documentation-governance.md) before
completion.
