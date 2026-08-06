-- CreateEnum
CREATE TYPE "NoteColor" AS ENUM ('YELLOW', 'RED', 'BLUE', 'GREEN', 'ORANGE', 'PURPLE');

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "content" VARCHAR(2000) NOT NULL,
    "color" "NoteColor" NOT NULL,
    "position" JSONB NOT NULL,
    "orientation" JSONB,
    "modelVersion" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notes_scanId_updatedAt_id_idx" ON "notes"("scanId", "updatedAt", "id");

-- CreateIndex
CREATE INDEX "notes_createdById_idx" ON "notes"("createdById");

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
