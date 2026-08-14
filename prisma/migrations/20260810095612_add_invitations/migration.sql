-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'REVOKED');

-- AlterTable
ALTER TABLE "project_accesses" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "declinedAt" TIMESTAMP(3),
ADD COLUMN     "invitationId" UUID;

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_projectId_status_idx" ON "invitations"("projectId", "status");

-- AddForeignKey
ALTER TABLE "project_accesses" ADD CONSTRAINT "project_accesses_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
