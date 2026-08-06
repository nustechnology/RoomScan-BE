-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('NONE', 'PENDING', 'UPLOADING', 'UPLOADED', 'FAILED');

-- CreateTable
CREATE TABLE "scans" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "thumbnail" VARCHAR(2048),
    "assetStatus" "AssetStatus" NOT NULL DEFAULT 'NONE',
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "modelVersion" INTEGER NOT NULL DEFAULT 1,
    "clientMutationId" VARCHAR(128),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scans_projectId_deletedAt_createdAt_id_idx" ON "scans"("projectId", "deletedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "scans_createdById_idx" ON "scans"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "scans_projectId_clientMutationId_key" ON "scans"("projectId", "clientMutationId");

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
