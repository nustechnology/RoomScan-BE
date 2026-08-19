-- Backfill the note title into existing NOTE sync_changes rows that were
-- created without it by the initial sync bootstrap in migration
-- 20260817040000_add_sync_idempotency_conflicts. The title column already
-- exists on notes; this only updates the denormalized JSON payload on
-- sync_changes so historical and live snapshots match.

UPDATE sync_changes sc
SET data = jsonb_set(sc.data, '{title}', to_jsonb(n.title))
FROM notes n
WHERE sc."resourceType" = 'NOTE'
  AND sc.operation = 'UPSERT'
  AND sc."resourceId" = n.id
  AND sc.data ? 'id'
  AND NOT sc.data ? 'title';
