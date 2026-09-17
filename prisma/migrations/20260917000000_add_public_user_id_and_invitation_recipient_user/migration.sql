-- Adds the human-shareable public user identifier and lets an invitation bind to
-- a specific user instead of a typed-in email address.
--
-- Email-addressed invitations remain supported (recipientEmail), so
-- "recipientEmail" becomes nullable and a CHECK constraint guarantees that every
-- invitation still carries exactly one recipient channel.

-- 1. users."publicId": nullable first so existing rows can be backfilled in place.
ALTER TABLE "users" ADD COLUMN "publicId" VARCHAR(10);

-- The unique index is created before the backfill, not after it. PostgreSQL
-- treats NULLs as distinct, so it happily covers the not-yet-filled rows, and
-- the collision probe inside the backfill becomes an index lookup instead of a
-- sequential scan per candidate — the difference between O(N) and O(N^2) over
-- the whole table.
CREATE UNIQUE INDEX "users_publicId_key" ON "users"("publicId");

-- Backfill every pre-existing user with a random 10-character identifier drawn
-- from an alphabet that omits characters people confuse when reading an id out
-- loud (0, 1, I, L, O, U are all absent).
--
-- Randomness comes from gen_random_uuid(), which is cryptographically strong and
-- built in from PostgreSQL 13 (no extension required), so backfilled ids are of
-- the same quality as the ones the application generates with node:crypto.
--
-- Two corrections keep the output uniform. Bytes 6 and 8 of a v4 UUID carry the
-- fixed version and variant bits, so they are not random and are skipped. Of the
-- remaining bytes, those at or above the largest multiple of the alphabet length
-- are rejected, which removes the modulo bias a plain `% 30` would introduce.
--
-- NOTE FOR OPERATORS: this statement rewrites every row of "users", and the
-- SET NOT NULL below takes an ACCESS EXCLUSIVE lock. On a large users table this
-- blocks sign-in for the duration; run it in a maintenance window, or split it
-- into add-nullable / batched-backfill / constrain migrations first.
DO $$
DECLARE
  alphabet CONSTANT TEXT := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  cutoff CONSTANT INTEGER := 240; -- 8 * length(alphabet)
  target RECORD;
  candidate TEXT;
  source BYTEA;
  byte_index INTEGER;
  byte_value INTEGER;
BEGIN
  FOR target IN SELECT "id" FROM "users" WHERE "publicId" IS NULL LOOP
    LOOP
      candidate := '';
      WHILE length(candidate) < 10 LOOP
        source := uuid_send(gen_random_uuid());
        FOR byte_index IN 0..15 LOOP
          EXIT WHEN length(candidate) >= 10;
          CONTINUE WHEN byte_index IN (6, 8); -- version / variant bits, not random
          byte_value := get_byte(source, byte_index);
          CONTINUE WHEN byte_value >= cutoff;
          candidate := candidate || substr(alphabet, (byte_value % length(alphabet)) + 1, 1);
        END LOOP;
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "users" WHERE "publicId" = candidate);
    END LOOP;
    UPDATE "users" SET "publicId" = candidate WHERE "id" = target."id";
  END LOOP;
END $$;

ALTER TABLE "users" ALTER COLUMN "publicId" SET NOT NULL;

-- 2. invitations: optional recipient user binding.
ALTER TABLE "invitations" ALTER COLUMN "recipientEmail" DROP NOT NULL;

ALTER TABLE "invitations" ADD COLUMN "recipientUserId" UUID;

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every invitation must be addressed to exactly one recipient channel.
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_recipient_channel_check"
  CHECK (num_nonnulls("recipientEmail", "recipientUserId") = 1);

CREATE INDEX "invitations_recipientUserId_status_idx" ON "invitations"("recipientUserId", "status");

-- Mirrors the existing per-email pending uniqueness at user-binding granularity.
CREATE UNIQUE INDEX "invitations_projectId_recipientUserId_pending_key"
  ON "invitations"("projectId", "recipientUserId")
  WHERE "status" = 'PENDING';

CREATE UNIQUE INDEX "invitations_scanId_recipientUserId_pending_key"
  ON "invitations"("scanId", "recipientUserId")
  WHERE "status" = 'PENDING';
