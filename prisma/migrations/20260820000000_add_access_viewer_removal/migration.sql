-- Viewer self-removal from the Shared With Me list.
--
-- A Viewer removing an item from their own list is distinct from an Owner
-- revoking access. The Owner revoke path continues to set revokedAt on the
-- ProjectAccess/ScanAccess row; the viewer remove path marks the SAME access
-- row with deletedAt so it disappears from the Viewer's list while the Owner
-- keeps the (non-revoked) access visible in their share management.
--
-- No backfill is needed: self-removal is a new capability introduced by this
-- migration, so no pre-existing project_accesses/scan_accesses row represents
-- a Viewer's own self-removal. Every revokedAt value written before this
-- migration was set by an Owner-only path (the revoke-viewer endpoint or
-- project/scan deletion cascade); only rows created going forward through the
-- new remove endpoints write deletedAt. This is documented in
-- document/development.md.

-- CreateEnum none.

ALTER TABLE "project_accesses"
  ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "scan_accesses"
  ADD COLUMN "deletedAt" TIMESTAMP(3);

-- The list/status indexes that add the "deletedAt" predicate are replaced by
-- the four follow-up migrations (20260820000001-20260820000004). Postgres
-- treats CREATE/DROP INDEX CONCURRENTLY as invalid inside a transaction
-- block, and Prisma Migrate applies every multi-statement migration.sql as an
-- implicit transaction, so each CONCURRENTLY statement must be the only
-- statement in its migration to run non-transactionally and avoid blocking
-- live reads/writes on project_accesses and scan_accesses.
