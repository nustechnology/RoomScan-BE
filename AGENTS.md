# RoomScan agent instructions

These instructions apply to every AI agent working in this repository.

## Mandatory documentation-first workflow

- Before analyzing, implementing, reviewing, or fixing anything, read
  `document/README.md` completely, then read
  `document/documentation-governance.md` and every task-specific document it
  maps. Do this before inspecting or changing implementation.
- Treat `document/` as the current human-readable contract for the checked-out
  branch. Resolve mismatches between documentation, source, tests, OpenAPI, and
  executable configuration in the same task.
- Every task that changes repository files must synchronize affected
  documentation on the same branch. Never defer documentation to a follow-up.
- Before handoff, re-check documentation against the final diff and include the
  required documentation-impact statement. If no documented fact changed, name
  the documents reviewed and explain why no content update was necessary.

The full completion gate in `document/documentation-governance.md` is
non-negotiable and blocks handoff, commit, pull request, or merge when
incomplete.

## Required context

- Read the root `README.md` when setup, commands, environment, Docker, or public
  endpoints are relevant.
- This is a Node.js 24, Yarn 4, Express 5, TypeScript ESM and Prisma 7 service.
- Preserve the application factory/runtime composition split between
  `src/app.ts` and `src/server.ts`.
- Prefer CodeGraph for symbol, caller, callee and impact questions. If the local
  `.codegraph` index is absent, run `codegraph init -i` before structural work.

## Repository skills

Shared, repository-local skills live under `.agents/skills`. Read a selected
skill's `SKILL.md` completely before following it, and resolve relative
references from that skill directory.

- Use
  [code-review-and-quality](.agents/skills/code-review-and-quality/SKILL.md)
  when asked to review code, assess code quality or merge readiness, review
  another agent's implementation, or perform the review gate before merging a
  change. Reviews are read-only unless the user also asks for fixes.

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

Local development uses Docker only for PostgreSQL. Run the API, Prisma
commands, seeds, validation, tests, coverage and builds natively with Yarn.
Start the database with `docker compose up db -d` only when it is not already
running, and do not restart or recreate it as a routine final check.

Do not run `docker compose build`, start the Compose API/migrate services, or
bring up the full stack during normal task verification. Docker-specific
validation is required only when the user explicitly requests it or the task's
acceptance criteria directly target Docker/container behavior. In that case,
run only the targeted checks needed and report them separately.

Update README, `document/` and OpenAPI registration whenever behavior changes.
Documentation synchronization is required before the native commands count as
a complete handoff.

## Repository hygiene

- Use Yarn only; do not add npm or pnpm lockfiles.
- Preserve unrelated user changes.
- Do not commit `.env`, generated output, coverage or `.codegraph`.
- Keep direct dependency versions deliberate and update `yarn.lock` atomically.
