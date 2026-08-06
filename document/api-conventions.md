# API conventions

## Routing

- Public application routes are versioned under `/api/v1`.
- Liveness and readiness are `/api/v1/health` and `/api/v1/ready`.
- Apple authentication is `POST /api/v1/auth/apple`.
- Token refresh is `POST /api/v1/auth/refresh`.
- Project management is `POST`, `GET`, `GET/:id`, `PATCH/:id`, and `DELETE/:id` at
  `/api/v1/projects`.
- Scan metadata is `POST` and `GET` at `/api/v1/projects/:projectId/scans`, and
  `GET`, `PATCH`, and `DELETE` at `/api/v1/scans/:scanId`.
- Swagger UI remains at `/api-doc`; raw OpenAPI is `/api-doc.json`.
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

Public API traffic has two process-local per-IP policies:

- `/api/v1` allows 120 requests per 60 seconds.
- `POST /api/v1/auth/apple` additionally allows 20 requests per 15 minutes.
- `POST /api/v1/auth/refresh` additionally allows 10 requests per 15 minutes.

`/api/v1/health`, `/api/v1/ready`, `/api-doc` and `/api-doc.json` are exempt.
All Apple attempts count, including validation, credential and dependency
failures. IPv6 clients are grouped by `/56`.

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
or store details. Browser clients may read the three headers through CORS.

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
    "provider": "apple"
  }
}
```

`user.email` may be `null`. The response never contains the Apple subject,
verification claims, signing details or secrets.

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
| `INVALID_REFRESH_TOKEN` | 401  | Missing, expired, revoked, or otherwise invalid token  |
| `RATE_LIMIT_EXCEEDED`   | 429  | Per-IP quota exceeded (10 req / 15 min)                |
| `INTERNAL_SERVER_ERROR` | 500  | Unexpected failure without secret or database exposure |

Rotation is stateful: each issued refresh JWT has a unique `jti` (JWT ID)
persisted in the `refresh_tokens` table until it expires or is revoked. When an
already-revoked `jti` is reused, the endpoint returns 401 with
`INVALID_REFRESH_TOKEN`. The service is designed to support token-theft
detection by revoking all sessions for a user when a stale `jti` is presented,
though the current implementation only rejects the stale token.

The same per-IP rate-limit headers (`RateLimit`, `RateLimit-Policy`, and
`Retry-After` on 429) apply to this endpoint.

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
    "email": "owner@example.com"
  },
  "scanCount": 0,
  "sharedCount": 0,
  "thumbnail": null,
  "syncStatus": null,
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

`owner.email` is nullable. An active Viewer receives role `VIEWER` with only
`canView: true`. `sharedCount` counts active Viewer access records.
`scanCount` counts active (non-deleted) scans in the project. `thumbnail` and
`syncStatus` are `null` until the downstream thumbnail and sync persistence
features are present.

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
    "email": "owner@example.com"
  },
  "noteCount": 0,
  "assetStatus": "NONE",
  "syncStatus": "PENDING",
  "modelVersion": 1,
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

`creator.email` is nullable. `noteCount` is `0` until the Note persistence
model is present. `assetStatus` uses `NONE | PENDING | UPLOADING | UPLOADED |
FAILED` and starts `NONE` for a metadata-only scan; `syncStatus` uses `PENDING |
SYNCING | SYNCED | FAILED | CONFLICT` and starts `PENDING`. The metadata
endpoints never accept model-file data; the asset and sync status write path is
the responsibility of the future upload module.

The scan list supports page-based pagination and an allow-listed sort. `page`
defaults to 1; `limit` defaults to 20 and may not exceed 100. `sort` defaults to
`createdAt:desc`. Supported values are `createdAt:desc`, `createdAt:asc`,
`updatedAt:desc`, `updatedAt:asc`, `name:asc`, and `name:desc`. Every order uses
`id` as its final stable tie-breaker.

Validation rules:

- `projectId` and `scanId`: UUID.
- `name` on create: required, trimmed Unicode string, 1–100 characters, not
  whitespace-only; duplicate names are allowed.
- `description`: optional nullable string, maximum 500 characters.
- `clientMutationId` on create: optional string, 1–128 characters; used for
  idempotent create and unique per project.
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
  project restores that scan (clears its `deletedAt`), applies the submitted
  `name` and `description`, and returns the restored scan with `200` (not
  created) instead of inserting a new row. A `clientMutationId` is unique per
  project, so the same value in a different project creates a new scan.
- Delete sets `deletedAt` and touches the parent project `updatedAt` in one
  transaction.
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
