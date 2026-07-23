# API conventions

## Routing

- Public application routes are versioned under `/api/v1`.
- Liveness and readiness are `/api/v1/health` and `/api/v1/ready`.
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
for missing routes/resources, 409 for state conflicts and 503 for unavailable
dependencies.

Every response includes a request correlation ID in the `x-request-id` header.
Error responses also include it in the `requestId` field. A non-empty incoming
`x-request-id` may be reused; otherwise the application generates one.

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
