import { randomUUID } from "node:crypto";
import { hmacHex } from "./crypto.mjs";

function canonicalEvent(event) {
  return JSON.stringify({
    id: event.id,
    tenantId: event.tenantId,
    actorId: event.actorId,
    actorType: event.actorType,
    action: event.action,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    metadata: event.metadata ?? {},
    previousEventHash: event.previousEventHash ?? null,
    createdAt: event.createdAt,
  });
}

export function appendAudit(db, auditKey, input) {
  const previous = db.prepare("SELECT event_hash FROM audit_events WHERE tenant_id = ? ORDER BY rowid DESC LIMIT 1").get(input.tenantId);
  const event = {
    id: randomUUID(),
    tenantId: input.tenantId,
    actorId: input.actorId,
    actorType: input.actorType,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: input.metadata ?? {},
    previousEventHash: previous?.event_hash ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const eventHash = hmacHex(auditKey, canonicalEvent(event));
  db.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, actor_type, action, target_type, target_id, metadata_json, previous_event_hash, event_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(event.id, event.tenantId, event.actorId, event.actorType, event.action, event.targetType, event.targetId, JSON.stringify(event.metadata), event.previousEventHash, eventHash, event.createdAt);
  return { ...event, eventHash };
}

export function listAudit(db, tenantId, limit = 100) {
  return db.prepare(`SELECT id, tenant_id, actor_id, actor_type, action, target_type, target_id,
    metadata_json, previous_event_hash, event_hash, created_at
    FROM audit_events WHERE tenant_id = ? ORDER BY rowid DESC LIMIT ?`).all(tenantId, limit).map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      actorId: row.actor_id,
      actorType: row.actor_type,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      metadata: JSON.parse(row.metadata_json),
      previousEventHash: row.previous_event_hash,
      eventHash: row.event_hash,
      createdAt: row.created_at,
    }));
}

export function verifyAuditChain(db, auditKey, tenantId) {
  const rows = db.prepare("SELECT * FROM audit_events WHERE tenant_id = ? ORDER BY rowid ASC").all(tenantId);
  let previousEventHash = null;
  for (const row of rows) {
    if (row.previous_event_hash !== previousEventHash) return false;
    const event = {
      id: row.id,
      tenantId: row.tenant_id,
      actorId: row.actor_id,
      actorType: row.actor_type,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      metadata: JSON.parse(row.metadata_json),
      previousEventHash: row.previous_event_hash,
      createdAt: row.created_at,
    };
    if (hmacHex(auditKey, canonicalEvent(event)) !== row.event_hash) return false;
    previousEventHash = row.event_hash;
  }
  return true;
}
