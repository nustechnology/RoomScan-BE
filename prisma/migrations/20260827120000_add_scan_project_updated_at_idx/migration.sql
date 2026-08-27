-- CreateIndex
CREATE INDEX "scans_projectId_deletedAt_updatedAt_id_idx" ON "scans"("projectId", "deletedAt", "updatedAt", "id");
