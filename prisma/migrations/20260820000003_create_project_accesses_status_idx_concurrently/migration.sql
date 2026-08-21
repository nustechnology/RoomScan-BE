-- Non-transactional: this migration must contain only this one statement so
-- Prisma Migrate does not wrap it in a transaction (CONCURRENTLY is invalid
-- inside a transaction block). See 20260820000000_add_access_viewer_removal.
-- Depends on the "deletedAt" column added by that migration.
CREATE INDEX CONCURRENTLY "project_accesses_userId_deletedAt_revokedAt_projectId_idx"
  ON "project_accesses"("userId", "deletedAt", "revokedAt", "projectId");
