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
3. Run `yarn install --immutable` and `yarn prisma:generate`.
4. Start PostgreSQL with `docker compose up db -d`.

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

For container changes also run:

```bash
docker compose config
docker compose build
docker compose up -d
```

Confirm `/api/v1/ready` and `/api-doc` before stopping the stack.

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

## Dependency and generated-file policy

Direct dependencies are pinned and the full graph is locked by `yarn.lock`.
Regenerate Prisma after schema or Prisma version changes. Do not commit
`node_modules`, `dist`, coverage output, generated Prisma Client, secrets or
the local CodeGraph index.

Update this document in the same branch whenever development commands, required
tool versions, environment setup, tests, coverage, hooks, CI, Docker, Prisma
workflow, dependency policy, generated artifacts, or handoff requirements
change.
