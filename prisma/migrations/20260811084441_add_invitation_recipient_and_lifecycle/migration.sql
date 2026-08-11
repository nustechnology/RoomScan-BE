/*
  Warnings:

  - You are about to drop the column `declinedAt` on the `project_accesses` table. All the data in the column will be lost.
  - Added the required column `recipientEmail` to the `invitations` table without a default value. This is not possible if the table is not empty.

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
ADD COLUMN     "recipientEmail" VARCHAR(320) NOT NULL;

-- AlterTable
ALTER TABLE "project_accesses" DROP COLUMN "declinedAt";

-- CreateIndex
CREATE INDEX "invitations_projectId_recipientEmail_idx" ON "invitations"("projectId", "recipientEmail");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
