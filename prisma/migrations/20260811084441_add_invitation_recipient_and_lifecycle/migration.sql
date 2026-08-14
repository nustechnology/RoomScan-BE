/*
  Warnings:

  - You are about to drop the column `declinedAt` on the `project_accesses` table. All the data in the column will be lost.
  - The required column `recipientEmail` is added with a placeholder backfill so the migration also applies when
    the `invitations` table already contains rows (for example on a partially deployed database).
*/

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvitationStatus" ADD VALUE 'ACCEPTED';
ALTER TYPE "InvitationStatus" ADD VALUE 'DECLINED';

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "acceptedByUserId" UUID,
ADD COLUMN     "declinedAt" TIMESTAMP(3),
ADD COLUMN     "recipientEmail" VARCHAR(320);

-- Revoke legacy PENDING invitations that have no recipient address so their
-- links stop working, then backfill a placeholder and make the column required.
UPDATE "invitations" SET "status" = 'REVOKED', "revokedAt" = NOW(), "updatedAt" = NOW() WHERE "recipientEmail" IS NULL AND "status" = 'PENDING';

-- Backfill existing rows before making the column required.
UPDATE "invitations" SET "recipientEmail" = '' WHERE "recipientEmail" IS NULL;

ALTER TABLE "invitations" ALTER COLUMN "recipientEmail" SET NOT NULL;

-- AlterTable
ALTER TABLE "project_accesses" DROP COLUMN "declinedAt";

-- CreateIndex
CREATE INDEX "invitations_projectId_recipientEmail_idx" ON "invitations"("projectId", "recipientEmail");

-- Partial unique index: at most one PENDING invitation per (project, recipient).
CREATE UNIQUE INDEX "invitations_projectId_recipientEmail_pending_key" ON "invitations"("projectId", "recipientEmail") WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
