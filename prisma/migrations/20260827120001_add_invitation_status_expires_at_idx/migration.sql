-- CreateIndex
CREATE INDEX "invitations_status_expiresAt_idx" ON "invitations"("status", "expiresAt");
