-- AlterTable
-- Project-scope invitations keep their projectId; scan-scope invitations use
-- scanId instead. Exactly one of the two is set (enforced by the CHECK below),
-- so the existing project partial unique index continues to guard PENDING
-- project invitations (scan rows have NULL projectId, which never collides).
ALTER TABLE "invitations" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "invitations" ADD COLUMN "scanId" UUID;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "invitations_scanId_status_idx" ON "invitations"("scanId", "status");
CREATE INDEX "invitations_scanId_recipientEmail_idx" ON "invitations"("scanId", "recipientEmail");

-- Partial unique index: at most one PENDING invitation per (scan, recipient).
CREATE UNIQUE INDEX "invitations_scanId_recipientEmail_pending_key" ON "invitations"("scanId", "recipientEmail") WHERE "status" = 'PENDING';

-- AddCheckConstraint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_scope_check" CHECK (("projectId" IS NOT NULL) <> ("scanId" IS NOT NULL));

-- CreateTable
CREATE TABLE "share_links" (
    "id" UUID NOT NULL,
    "projectId" UUID,
    "scanId" UUID,
    "createdById" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_accesses" (
    "id" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'VIEWER',
    "invitationId" UUID,
    "shareLinkId" UUID,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scan_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "share_links_tokenHash_key" ON "share_links"("tokenHash");
CREATE INDEX "share_links_projectId_revokedAt_expiresAt_idx" ON "share_links"("projectId", "revokedAt", "expiresAt");
CREATE INDEX "share_links_scanId_revokedAt_expiresAt_idx" ON "share_links"("scanId", "revokedAt", "expiresAt");
CREATE UNIQUE INDEX "scan_accesses_scanId_userId_key" ON "scan_accesses"("scanId", "userId");
CREATE INDEX "scan_accesses_userId_revokedAt_scanId_idx" ON "scan_accesses"("userId", "revokedAt", "scanId");

-- AddCheckConstraint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_scope_check" CHECK (("projectId" IS NOT NULL) <> ("scanId" IS NOT NULL));

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "project_accesses" ADD COLUMN "shareLinkId" UUID;

-- AddForeignKey
ALTER TABLE "project_accesses" ADD CONSTRAINT "project_accesses_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "share_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_accesses" ADD CONSTRAINT "scan_accesses_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scan_accesses" ADD CONSTRAINT "scan_accesses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scan_accesses" ADD CONSTRAINT "scan_accesses_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scan_accesses" ADD CONSTRAINT "scan_accesses_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "share_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
