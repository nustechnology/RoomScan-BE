-- SIT-39: durable sync feed, idempotency receipts, and optimistic conflicts.

-- CreateEnum
CREATE TYPE "SyncResourceType" AS ENUM ('PROJECT', 'SCAN', 'NOTE', 'SCAN_ASSET', 'PROJECT_ACCESS');
CREATE TYPE "SyncOperation" AS ENUM ('UPSERT', 'DELETE');

-- Replace indexes whose predicates now include tombstone state.
DROP INDEX "notes_scanId_updatedAt_id_idx";
DROP INDEX "scan_assets_idempotencyKey_key";
DROP INDEX "scan_assets_scanId_status_idx";

-- Revision and tombstone columns backfill existing rows to revision 1.
ALTER TABLE "notes"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "project_accesses"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "projects"
  ADD COLUMN "lastSyncedAt" TIMESTAMP(3),
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "syncStatus" "SyncStatus" NOT NULL DEFAULT 'SYNCED';
ALTER TABLE "scan_assets"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "scans"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

-- Raw idempotency keys and plaintext responses are never persisted here.
CREATE TABLE "idempotency_receipts" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "operation" VARCHAR(64) NOT NULL,
  "parentScope" VARCHAR(80) NOT NULL,
  "keyHash" CHAR(64) NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "responseStatus" INTEGER NOT NULL,
  "responseCiphertext" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idempotency_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sync_changes" (
  "id" BIGSERIAL NOT NULL,
  "projectId" UUID NOT NULL,
  "ownerId" UUID NOT NULL,
  "targetUserId" UUID,
  "resourceType" "SyncResourceType" NOT NULL,
  "resourceId" UUID NOT NULL,
  "operation" "SyncOperation" NOT NULL,
  "revision" INTEGER NOT NULL,
  "syncStatus" "SyncStatus" NOT NULL,
  "data" JSONB,
  "deletedAt" TIMESTAMP(3),
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sync_changes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sync_conflicts" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "resourceType" "SyncResourceType" NOT NULL,
  "resourceId" UUID NOT NULL,
  "serverRevision" INTEGER NOT NULL,
  "refreshChangeId" BIGINT NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idempotency_receipts_createdAt_idx" ON "idempotency_receipts"("createdAt");
CREATE UNIQUE INDEX "idempotency_receipts_userId_operation_parentScope_keyHash_key"
  ON "idempotency_receipts"("userId", "operation", "parentScope", "keyHash");
CREATE INDEX "sync_changes_projectId_id_idx" ON "sync_changes"("projectId", "id");
CREATE INDEX "sync_changes_ownerId_id_idx" ON "sync_changes"("ownerId", "id");
CREATE INDEX "sync_changes_targetUserId_id_idx" ON "sync_changes"("targetUserId", "id");
CREATE INDEX "sync_changes_resourceType_resourceId_id_idx"
  ON "sync_changes"("resourceType", "resourceId", "id");
CREATE INDEX "sync_changes_changedAt_id_idx" ON "sync_changes"("changedAt", "id");
CREATE INDEX "sync_conflicts_userId_projectId_resolvedAt_idx"
  ON "sync_conflicts"("userId", "projectId", "resolvedAt");
CREATE INDEX "sync_conflicts_refreshChangeId_idx" ON "sync_conflicts"("refreshChangeId");
CREATE UNIQUE INDEX "sync_conflicts_userId_resourceType_resourceId_key"
  ON "sync_conflicts"("userId", "resourceType", "resourceId");
CREATE INDEX "notes_scanId_deletedAt_updatedAt_id_idx"
  ON "notes"("scanId", "deletedAt", "updatedAt", "id");
CREATE INDEX "scan_assets_scanId_deletedAt_status_idx"
  ON "scan_assets"("scanId", "deletedAt", "status");
CREATE UNIQUE INDEX "scan_assets_scanId_idempotencyKey_key"
  ON "scan_assets"("scanId", "idempotencyKey");

ALTER TABLE "idempotency_receipts"
  ADD CONSTRAINT "idempotency_receipts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sync_changes"
  ADD CONSTRAINT "sync_changes_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sync_changes_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sync_changes_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sync_conflicts"
  ADD CONSTRAINT "sync_conflicts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sync_conflicts_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "sync_conflicts_refreshChangeId_fkey"
  FOREIGN KEY ("refreshChangeId") REFERENCES "sync_changes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill project readiness. A project with no active scans is fully synced;
-- otherwise every active scan must have an uploaded MODEL asset.
WITH readiness AS (
  SELECT
    p.id,
    COUNT(s.id) AS scan_count,
    COUNT(s.id) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM scan_assets a
        WHERE a."scanId" = s.id
          AND a."assetType" = 'MODEL'
          AND a.status = 'UPLOADED'
          AND a."deletedAt" IS NULL
      )
    ) AS uploaded_count,
    BOOL_OR(EXISTS (
      SELECT 1 FROM scan_assets a
      WHERE a."scanId" = s.id AND a."assetType" = 'MODEL'
        AND a.status = 'FAILED' AND a."deletedAt" IS NULL
    )) AS has_failed,
    BOOL_OR(EXISTS (
      SELECT 1 FROM scan_assets a
      WHERE a."scanId" = s.id AND a."assetType" = 'MODEL'
        AND a.status = 'UPLOADING' AND a."deletedAt" IS NULL
    )) AS has_uploading,
    MAX(a."uploadedAt") FILTER (
      WHERE a."assetType" = 'MODEL' AND a.status = 'UPLOADED' AND a."deletedAt" IS NULL
    ) AS latest_model_upload
  FROM projects p
  LEFT JOIN scans s ON s."projectId" = p.id AND s."deletedAt" IS NULL
  LEFT JOIN scan_assets a ON a."scanId" = s.id
  GROUP BY p.id
)
UPDATE projects p
SET
  "syncStatus" = CASE
    WHEN r.scan_count = 0 OR r.uploaded_count = r.scan_count THEN 'SYNCED'::"SyncStatus"
    WHEN r.has_failed THEN 'FAILED'::"SyncStatus"
    WHEN r.has_uploading THEN 'SYNCING'::"SyncStatus"
    ELSE 'PENDING'::"SyncStatus"
  END,
  "lastSyncedAt" = CASE
    WHEN r.scan_count = 0 THEN p."updatedAt"
    WHEN r.uploaded_count = r.scan_count THEN COALESCE(r.latest_model_upload, p."updatedAt")
    ELSE NULL
  END
FROM readiness r
WHERE p.id = r.id;

-- Initial immutable UPSERTs allow the first full snapshot to be served entirely
-- from the change log without querying mutable domain rows.
INSERT INTO sync_changes
  ("projectId", "ownerId", "resourceType", "resourceId", operation, revision, "syncStatus", data, "changedAt")
SELECT p.id, p."ownerId", 'PROJECT', p.id, 'UPSERT', p.revision, p."syncStatus",
  jsonb_build_object(
    'id', p.id, 'ownerId', p."ownerId", 'ownerEmail', u.email,
    'name', p.name, 'description', p.description,
    'createdAt', to_char(p."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(p."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'lastSyncedAt', to_char(p."lastSyncedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ), p."updatedAt"
FROM projects p
JOIN users u ON u.id = p."ownerId"
WHERE p."deletedAt" IS NULL;

INSERT INTO sync_changes
  ("projectId", "ownerId", "resourceType", "resourceId", operation, revision, "syncStatus", data, "changedAt")
SELECT s."projectId", p."ownerId", 'SCAN', s.id, 'UPSERT', s.revision, s."syncStatus",
  jsonb_build_object(
    'id', s.id, 'projectId', s."projectId", 'createdById', s."createdById",
    'creatorEmail', u.email, 'name', s.name, 'description', s.description,
    'thumbnail', s.thumbnail, 'assetStatus', s."assetStatus", 'modelVersion', s."modelVersion",
    'createdAt', to_char(s."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(s."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ), s."updatedAt"
FROM scans s
JOIN projects p ON p.id = s."projectId"
JOIN users u ON u.id = s."createdById"
WHERE s."deletedAt" IS NULL AND p."deletedAt" IS NULL;

INSERT INTO sync_changes
  ("projectId", "ownerId", "resourceType", "resourceId", operation, revision, "syncStatus", data, "changedAt")
SELECT s."projectId", p."ownerId", 'NOTE', n.id, 'UPSERT', n.revision, 'SYNCED',
  jsonb_build_object(
    'id', n.id, 'scanId', n."scanId", 'createdById', n."createdById",
    'creatorEmail', u.email, 'content', n.content, 'color', n.color,
    'position', n.position, 'orientation', n.orientation, 'modelVersion', n."modelVersion",
    'createdAt', to_char(n."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(n."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ), n."updatedAt"
FROM notes n
JOIN scans s ON s.id = n."scanId"
JOIN projects p ON p.id = s."projectId"
JOIN users u ON u.id = n."createdById"
WHERE n."deletedAt" IS NULL AND s."deletedAt" IS NULL AND p."deletedAt" IS NULL;

INSERT INTO sync_changes
  ("projectId", "ownerId", "resourceType", "resourceId", operation, revision, "syncStatus", data, "changedAt")
SELECT s."projectId", p."ownerId", 'SCAN_ASSET', a.id, 'UPSERT', a.revision,
  CASE a.status
    WHEN 'UPLOADED' THEN 'SYNCED'::"SyncStatus"
    WHEN 'UPLOADING' THEN 'SYNCING'::"SyncStatus"
    WHEN 'FAILED' THEN 'FAILED'::"SyncStatus"
    ELSE 'PENDING'::"SyncStatus"
  END,
  jsonb_build_object(
    'id', a.id, 'scanId', a."scanId", 'assetType', a."assetType", 'status', a.status,
    'contentType', a."contentType", 'sizeBytes', a."sizeBytes", 'checksum', a.checksum,
    'modelVersion', a."modelVersion", 'uploadedAt', to_char(a."uploadedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'uploadUrlExpiresAt', to_char(a."uploadUrlExpiresAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt', to_char(a."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(a."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ), a."updatedAt"
FROM scan_assets a
JOIN scans s ON s.id = a."scanId"
JOIN projects p ON p.id = s."projectId"
WHERE a."deletedAt" IS NULL AND s."deletedAt" IS NULL AND p."deletedAt" IS NULL;

-- Owners see the un-targeted access event; each active Viewer sees only their
-- own targeted access event.
INSERT INTO sync_changes
  ("projectId", "ownerId", "resourceType", "resourceId", operation, revision, "syncStatus", data, "changedAt")
SELECT pa."projectId", p."ownerId", 'PROJECT_ACCESS', pa.id, 'UPSERT', pa.revision, 'SYNCED',
  jsonb_build_object(
    'id', pa.id, 'projectId', pa."projectId", 'userId', pa."userId", 'userEmail', u.email,
    'role', pa.role, 'acceptedAt', to_char(pa."acceptedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt', to_char(pa."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(pa."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ), pa."updatedAt"
FROM project_accesses pa
JOIN projects p ON p.id = pa."projectId"
JOIN users u ON u.id = pa."userId"
WHERE pa."revokedAt" IS NULL AND p."deletedAt" IS NULL;

INSERT INTO sync_changes
  ("projectId", "ownerId", "targetUserId", "resourceType", "resourceId", operation, revision, "syncStatus", data, "changedAt")
SELECT pa."projectId", p."ownerId", pa."userId", 'PROJECT_ACCESS', pa.id, 'UPSERT', pa.revision, 'SYNCED',
  jsonb_build_object(
    'id', pa.id, 'projectId', pa."projectId", 'userId', pa."userId", 'userEmail', u.email,
    'role', pa.role, 'acceptedAt', to_char(pa."acceptedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt', to_char(pa."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(pa."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ), pa."updatedAt"
FROM project_accesses pa
JOIN projects p ON p.id = pa."projectId"
JOIN users u ON u.id = pa."userId"
WHERE pa."revokedAt" IS NULL AND p."deletedAt" IS NULL;
