-- Non-transactional: this migration must contain only this one statement so
-- Prisma Migrate does not wrap it in a transaction (CONCURRENTLY is invalid
-- inside a transaction block). See 20260820000000_add_access_viewer_removal.
DROP INDEX CONCURRENTLY IF EXISTS "project_accesses_userId_revokedAt_projectId_idx";
