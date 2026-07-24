# API conventions

## Routing

- Public application routes are versioned under `/api/v1`.
- Liveness and readiness are `/api/v1/health` and `/api/v1/ready`.
- Apple authentication is `POST /api/v1/auth/apple`.
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
16 KiB and an optional `nonce` string of at most 512 bytes. Unknown fields are
rejected. When a nonce is provided the server validates it against the identity
token's `nonce` claim before looking up a user. The server validates the Apple
signature, issuer, client audience, expiration, issued-at time and subject
regardless of nonce.

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
The endpoint does not exchange Apple authorization codes and does not provide
an application refresh endpoint.

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
