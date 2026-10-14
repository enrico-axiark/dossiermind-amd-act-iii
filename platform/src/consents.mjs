import { randomUUID } from 'node:crypto';
import { assert } from './errors.mjs';
import { transaction } from './db.mjs';
import { appendAudit } from './audit.mjs';
const scopesAllowed = ['tenant:read','documents:read','documents:write','jobs:read','jobs:write','audit:read'];
const now = () => new Date().toISOString();
export function migrateConsents(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS consents (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
    user_id TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL
      CHECK(status IN ('pending','active','revoked','rejected','preconfigured')),
    scopes_json TEXT NOT NULL, requested_at TEXT NOT NULL, decided_at TEXT,
    decided_by TEXT, UNIQUE(tenant_id,user_id));`);
  // Preserve existing access, explicitly labelled configuration, never owner approval.
  db.exec(`INSERT OR IGNORE INTO consents
    (id,tenant_id,user_id,status,scopes_json,requested_at,decided_by)
    SELECT lower(hex(randomblob(16))),tenant_id,user_id,'preconfigured',scopes_json,created_at,'configuration'
    FROM memberships WHERE role='accountant';`);
}
function owner(db, principal, tenantId) {
  const member=db.prepare(`SELECT m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id
    JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND t.status='active' AND u.status='active'`).get(tenantId,principal.id);
  assert(principal.type==='user' && member?.role==='owner',403,'owner_required','Only the current owner can manage access');
}
function dto(db,row) {
  const user=db.prepare('SELECT display_name FROM users WHERE id=?').get(row.user_id);
  return {id:row.id,userId:row.user_id,name:user?.display_name||'Studio',status:row.status,
    scopes:JSON.parse(row.scopes_json),requestedAt:row.requested_at,decidedAt:row.decided_at};
}
export class ConsentService {
  constructor(db,config){this.db=db;this.config=config;}
  mine(principal) { return this.db.prepare("SELECT c.*,t.name AS tenant_name FROM consents c JOIN tenants t ON t.id=c.tenant_id WHERE c.user_id=? AND t.status='active' ORDER BY c.requested_at DESC").all(principal.id).map(row=>({...dto(this.db,row),tenantId:row.tenant_id,tenantName:row.tenant_name})); }
  request(tenantId,principal) {
    assert(principal.type==='user' && this.db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(principal.id),403,'user_required','Registered active user required');
    assert(this.db.prepare("SELECT 1 FROM tenants WHERE id=? AND status='active'").get(tenantId),404,'not_found','Access request unavailable');
    assert(this.db.prepare('SELECT role FROM memberships WHERE tenant_id=? AND user_id=?').get(tenantId,principal.id)?.role!=='owner',409,'owner_already_authorized','Owner already has access');
    return transaction(this.db,()=>{
      let row=this.db.prepare('SELECT * FROM consents WHERE tenant_id=? AND user_id=?').get(tenantId,principal.id);
      if(row && ['active','pending','preconfigured'].includes(row.status))return dto(this.db,row);
      const id=row?.id||randomUUID();
      this.db.prepare(`INSERT INTO consents(id,tenant_id,user_id,status,scopes_json,requested_at) VALUES(?,?,?,'pending',?,?)
        ON CONFLICT(tenant_id,user_id) DO UPDATE SET status='pending',requested_at=excluded.requested_at,decided_at=NULL,decided_by=NULL,scopes_json=excluded.scopes_json`)
        .run(id,tenantId,principal.id,JSON.stringify(scopesAllowed),now());
      appendAudit(this.db,this.config.auditKey,{tenantId,actorId:principal.id,actorType:principal.type,action:'consent.requested',targetType:'consent',targetId:id});
      return dto(this.db,this.db.prepare('SELECT * FROM consents WHERE id=?').get(id));
    });
  }
  list(tenantId,principal){owner(this.db,principal,tenantId);return this.db.prepare('SELECT * FROM consents WHERE tenant_id=? ORDER BY requested_at DESC').all(tenantId).map(row=>dto(this.db,row));}
  decide(tenantId,id,{action,scopes},principal) {
    owner(this.db,principal,tenantId);
    assert(['approve','revoke','reject'].includes(action),400,'validation_error','Unknown consent action');
    if(action==='approve')assert(Array.isArray(scopes)&&scopes.length>0&&scopes.every(s=>scopesAllowed.includes(s)),400,'invalid_consent_scopes','Only allowed collaboration scopes may be granted');
    return transaction(this.db,()=>{
      const row=this.db.prepare('SELECT * FROM consents WHERE id=? AND tenant_id=?').get(id,tenantId);
      assert(row,404,'not_found','Consent not found');
      assert(this.db.prepare('SELECT role FROM memberships WHERE tenant_id=? AND user_id=?').get(tenantId,row.user_id)?.role!=='owner',409,'owner_access_protected','Owner membership cannot be changed by consent');
      const status={approve:'active',revoke:'revoked',reject:'rejected'}[action];
      assert(action==='approve'?row.status==='pending':action==='reject'?row.status==='pending':['active','preconfigured','pending'].includes(row.status),409,'consent_transition_invalid','Consent action is not available');
      assert(action!=='approve'||this.db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(row.user_id),409,'user_inactive','User unavailable');
      const granted=action==='approve'?[...new Set(scopes)]:JSON.parse(row.scopes_json);
      if(action==='approve')this.db.prepare(`INSERT INTO memberships(tenant_id,user_id,role,scopes_json,created_at) VALUES(?,?,'accountant',?,?)
        ON CONFLICT(tenant_id,user_id) DO UPDATE SET role='accountant',scopes_json=excluded.scopes_json`).run(tenantId,row.user_id,JSON.stringify(granted),now());
      else if(action==='revoke')this.db.prepare("DELETE FROM memberships WHERE tenant_id=? AND user_id=? AND role='accountant'").run(tenantId,row.user_id);
      this.db.prepare('UPDATE consents SET status=?,scopes_json=?,decided_at=?,decided_by=? WHERE id=?').run(status,JSON.stringify(granted),now(),principal.id,id);
      if(action!=='reject')this.db.prepare('UPDATE tenants SET access_epoch=access_epoch+1 WHERE id=?').run(tenantId);
      appendAudit(this.db,this.config.auditKey,{tenantId,actorId:principal.id,actorType:principal.type,action:'consent.'+{approve:'approved',revoke:'revoked',reject:'rejected'}[action],targetType:'consent',targetId:id,metadata:{userId:row.user_id,scopes:granted}});
      return dto(this.db,this.db.prepare('SELECT * FROM consents WHERE id=?').get(id));
    });
  }
}
