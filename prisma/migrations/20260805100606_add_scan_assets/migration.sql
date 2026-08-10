-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('MODEL', 'THUMBNAIL');

-- CreateTable
CREATE TABLE "scan_assets" (
    "id" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
    "contentType" VARCHAR(128) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" VARCHAR(128),
    "modelVersion" VARCHAR(64),
    "storageKey" VARCHAR(512) NOT NULL,
    "idempotencyKey" VARCHAR(128),
    "uploadedAt" TIMESTAMP(3),
    "uploadUrlExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scan_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scan_assets_scanId_status_idx" ON "scan_assets"("scanId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "scan_assets_scanId_assetType_key" ON "scan_assets"("scanId", "assetType");

-- CreateIndex
CREATE UNIQUE INDEX "scan_assets_idempotencyKey_key" ON "scan_assets"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "scan_assets" ADD CONSTRAINT "scan_assets_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
