-- Viewer self-removal from the Shared With Me list.
--
-- A Viewer removing an item from their own list is distinct from an Owner
-- revoking access. The Owner revoke path continues to set revokedAt on the
-- ProjectAccess/ScanAccess row; the viewer remove path marks the SAME access
-- row with deletedAt so it disappears from the Viewer's list while the Owner
-- keeps the (non-revoked) access visible in their share management.
--
-- Existing viewer self-removals were historically stored via revokedAt and are
-- indistinguishable from Owner revokes; those rows are left unchanged. Only new
-- removals write deletedAt.

-- CreateEnum none.

-- Replace list/status indexes to include the viewer-removal tombstone predicate.
DROP INDEX "project_accesses_userId_revokedAt_projectId_idx";
DROP INDEX "scan_accesses_userId_revokedAt_scanId_idx";

ALTER TABLE "project_accesses"
  ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "scan_accesses"
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "project_accesses_userId_deletedAt_revokedAt_projectId_idx"
  ON "project_accesses"("userId", "deletedAt", "revokedAt", "projectId");
CREATE INDEX "scan_accesses_userId_deletedAt_revokedAt_scanId_idx"
  ON "scan_accesses"("userId", "deletedAt", "revokedAt", "scanId");
