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

## Health semantics

Liveness proves only that the HTTP process can respond. Readiness may query
required dependencies and must return 503 when PostgreSQL is unavailable.
