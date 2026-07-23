# Development workflow

## Before coding

1. Use Node 24 and the Yarn version in `packageManager`.
2. Copy `.env.example` to `.env`.
3. Run `yarn install --immutable` and `yarn prisma:generate`.
4. Start PostgreSQL with `docker compose up db -d`.

## Before handoff

Run:

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
