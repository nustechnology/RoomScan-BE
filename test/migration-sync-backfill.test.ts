import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = new URL(
  '../prisma/migrations/20260817040000_add_sync_idempotency_conflicts/migration.sql',
  import.meta.url,
);

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

describe('add_sync_idempotency_conflicts migration', () => {
  it('backfills a revision for every revisioned resource', () => {
    const sql = migrationSql();
    for (const table of ['notes', 'project_accesses', 'projects', 'scan_assets', 'scans']) {
      expect(sql).toContain(`ALTER TABLE "${table}"`);
    }
    expect(sql).toContain('ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1');
  });

  it('adds tombstones and readiness columns without wiping existing rows', () => {
    const sql = migrationSql();
    expect(sql).toContain('ALTER TABLE "notes"');
    expect(sql).toContain('ADD COLUMN "deletedAt" TIMESTAMP(3)');
    expect(sql).toContain('ALTER TABLE "scan_assets"');
    expect(sql).toContain('ADD COLUMN "deletedAt" TIMESTAMP(3)');
    expect(sql).toContain('ALTER TABLE "projects"');
    expect(sql).toContain('ADD COLUMN "lastSyncedAt" TIMESTAMP(3)');
    expect(sql).toContain('ADD COLUMN "syncStatus" "SyncStatus" NOT NULL DEFAULT \'SYNCED\'');
  });

  it('scopes the scan asset legacy idempotency key to the parent scan', () => {
    const sql = migrationSql();
    expect(sql).toContain('DROP INDEX "scan_assets_idempotencyKey_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "scan_assets_scanId_idempotencyKey_key"');
    expect(sql).toContain('ON "scan_assets"("scanId", "idempotencyKey")');
  });

  it('creates receipts, the immutable change feed, and per-user conflicts', () => {
    const sql = migrationSql();
    expect(sql).toContain('CREATE TABLE "idempotency_receipts"');
    expect(sql).toContain('"responseCiphertext" BYTEA NOT NULL');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "idempotency_receipts_userId_operation_parentScope_keyHash_key"',
    );
    expect(sql).toContain('CREATE TABLE "sync_changes"');
    expect(sql).toContain('"id" BIGSERIAL NOT NULL');
    expect(sql).toContain('CREATE TABLE "sync_conflicts"');
    expect(sql).toContain('"refreshChangeId" BIGINT NOT NULL');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "sync_conflicts_userId_resourceType_resourceId_key"',
    );
  });

  it('backfills project readiness from active scans and uploaded MODEL assets', () => {
    const sql = migrationSql();
    expect(sql).toContain('UPDATE projects p');
    expect(sql).toContain('SET');
    expect(sql).toContain('"syncStatus" = CASE');
    expect(sql).toContain('WHEN r.scan_count = 0 OR r.uploaded_count = r.scan_count');
    expect(sql).toContain('\'SYNCED\'::"SyncStatus"');
    expect(sql).toContain('LEFT JOIN scans s ON s."projectId" = p.id AND s."deletedAt" IS NULL');
  });

  it('emits initial UPSERT snapshots for every resource type', () => {
    const sql = migrationSql();
    expect(sql).toContain("'PROJECT', p.id, 'UPSERT'");
    expect(sql).toContain("'SCAN', s.id, 'UPSERT'");
    expect(sql).toContain("'NOTE', n.id, 'UPSERT'");
    expect(sql).toContain("'SCAN_ASSET', a.id, 'UPSERT'");
    expect(sql).toContain("'PROJECT_ACCESS', pa.id, 'UPSERT'");
  });

  it('emits owner and targeted Viewer access snapshots', () => {
    const sql = migrationSql();
    expect(sql).toContain('"targetUserId"');
    expect(sql).toContain('pa."userId", \'PROJECT_ACCESS\'');
  });

  it('emits Z-suffixed ISO timestamps matching the runtime DTO format', () => {
    const sql = migrationSql();
    expect(sql).toContain('to_char(p."createdAt", \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\')');
    expect(sql).toContain('to_char(a."uploadedAt", \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\')');
    expect(sql).toContain('to_char(pa."acceptedAt", \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\')');
  });
});
