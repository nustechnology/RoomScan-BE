# RoomScan agent instructions

These instructions apply to every AI agent working in this repository.

## Required context

- Read `README.md` and the relevant file under `document/` before changing
  behavior.
- This is a Node.js 24, Yarn 4, Express 5, TypeScript ESM and Prisma 7 service.
- Preserve the application factory/runtime composition split between
  `src/app.ts` and `src/server.ts`.
- Prefer CodeGraph for symbol, caller, callee and impact questions. If the local
  `.codegraph` index is absent, run `codegraph init -i` before structural work.

## Architecture rules

- Put business behavior in a module under `src/modules`.
- Depend on narrow interfaces and inject infrastructure dependencies.
- Validate external input with Zod.
- Use the same Zod schemas to register OpenAPI routes and responses.
- Keep public routes under `/api/v1`; keep Swagger at `/api-doc`.
- Send expected failures through `AppError` and the standard error envelope.
- Never expose secrets, SQL, connection strings or internal stack traces.

## Prisma rules

- Use Prisma 7's PostgreSQL driver adapter.
- Change data structures through `prisma/schema.prisma` and reviewed migrations.
- Never hand-edit or commit `src/generated/prisma`.
- Never create or rewrite a production migration without explicit authorization.

## Required validation

Before handing work back, run:

```bash
yarn validate
yarn test:coverage
yarn build
```

Run Docker checks when Docker or runtime composition changes. Update README,
`document/` and OpenAPI registration whenever behavior changes.

## Repository hygiene

- Use Yarn only; do not add npm or pnpm lockfiles.
- Preserve unrelated user changes.
- Do not commit `.env`, generated output, coverage or `.codegraph`.
- Keep direct dependency versions deliberate and update `yarn.lock` atomically.
