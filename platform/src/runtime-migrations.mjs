export function migrateRuntime(db) {
  db.exec('PRAGMA busy_timeout = 5000');
  if (db.prepare('PRAGMA user_version').get().user_version >= 1) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    // Existing baseline has no foreign keys to documents; keep original hashes
    // while allowing a deleted file to be uploaded again as a new source version.
    db.exec(`CREATE TABLE documents_runtime (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      original_filename TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL, stored_path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'stored',
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT);
      INSERT INTO documents_runtime SELECT * FROM documents;
      DROP TABLE documents; ALTER TABLE documents_runtime RENAME TO documents;
      CREATE UNIQUE INDEX documents_active_hash ON documents(tenant_id,sha256) WHERE deleted_at IS NULL;
      ALTER TABLE tenants ADD COLUMN access_epoch INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE jobs ADD COLUMN access_epoch INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE jobs ADD COLUMN authority TEXT NOT NULL DEFAULT 'membership';
      ALTER TABLE jobs ADD COLUMN lease_owner TEXT;
      ALTER TABLE jobs ADD COLUMN lease_until INTEGER;
      ALTER TABLE jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE jobs ADD COLUMN progress_json TEXT;
      ALTER TABLE jobs ADD COLUMN error_code TEXT;
      ALTER TABLE jobs ADD COLUMN job_key TEXT;
      CREATE UNIQUE INDEX jobs_dedup_key ON jobs(tenant_id,job_key) WHERE job_key IS NOT NULL;
      CREATE TABLE document_extractions (
        document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        source_sha256 TEXT NOT NULL, bundle_id TEXT NOT NULL, stored_path TEXT NOT NULL,
        parser_version TEXT NOT NULL, fragment_count INTEGER NOT NULL,
        status TEXT NOT NULL, warnings_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX extraction_tenant ON document_extractions(tenant_id);
      PRAGMA user_version = 1;`);
    // Jobs queued before runtime implementation cannot inherit new authority.
    db.exec("UPDATE jobs SET status='cancelled',error_code='legacy_job_requeue_required',completed_at=datetime('now') WHERE status='queued'");
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
