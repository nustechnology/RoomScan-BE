-- Add optimistic-concurrency revision counters to projects, scans, and notes.
-- Notes also become soft-deletable so sync can surface delete tombstones.
ALTER TABLE "projects" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "scans" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "notes" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "statusCode" INTEGER NOT NULL DEFAULT 0,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_userId_key_key" ON "idempotency_records"("userId", "key");
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- Changes-feed ordering index for scans (projectId, updatedAt, id).
CREATE INDEX "scans_projectId_updatedAt_id_idx" ON "scans"("projectId", "updatedAt", "id");

-- Changes-feed ordering index for notes (scanId, deletedAt, updatedAt, id).
CREATE INDEX "notes_scanId_deletedAt_updatedAt_id_idx" ON "notes"("scanId", "deletedAt", "updatedAt", "id");

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
