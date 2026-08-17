-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.

ALTER TYPE "NoteColor" ADD VALUE 'CYAN';
ALTER TYPE "NoteColor" ADD VALUE 'GRAY';

-- AlterTable
-- The required column `title` is added with a placeholder backfill so the
-- migration also applies when the `notes` table already contains rows (for
-- example on a partially deployed database).
ALTER TABLE "notes" ADD COLUMN     "title" VARCHAR(50) NOT NULL DEFAULT '';

ALTER TABLE "notes" ALTER COLUMN "title" DROP DEFAULT;
