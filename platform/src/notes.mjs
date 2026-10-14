import {randomUUID} from 'node:crypto';
import {assert} from './errors.mjs';
import {transaction} from './db.mjs';
import {authorizeTenant} from './auth.mjs';
import {getTenantKey} from './storage.mjs';
import {encodeEncryptedBlob,decodeEncryptedBlob} from './crypto.mjs';
import {readExtraction} from './ingestion.mjs';
import {appendAudit} from './audit.mjs';
export function migrateNotes(db){
  db.exec(`CREATE TABLE IF NOT EXISTS source_notes (
    id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS note_revisions (
    note_id TEXT NOT NULL REFERENCES source_notes(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,body BLOB NOT NULL,author_id TEXT NOT NULL,created_at TEXT NOT NULL,
    PRIMARY KEY(note_id,version));
    CREATE TABLE IF NOT EXISTS note_sources (
    note_id TEXT NOT NULL REFERENCES source_notes(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    PRIMARY KEY(note_id,version,document_id));
    CREATE INDEX IF NOT EXISTS notes_tenant ON source_notes(tenant_id);
    CREATE INDEX IF NOT EXISTS notes_document ON note_sources(document_id);`);
}
export function purgeDocumentNotes(db,tenantId,documentId){
  db.prepare(`DELETE FROM source_notes WHERE tenant_id=? AND id IN
    (SELECT note_id FROM note_sources WHERE document_id=?)`).run(tenantId,documentId);
}
export class NoteService {
  constructor(db,config){this.db=db;this.config=config;}
  decode(tenantId,row){
    const body=JSON.parse(decodeEncryptedBlob(Buffer.from(row.body),getTenantKey(this.db,this.config,tenantId),`note:${tenantId}:${row.note_id}:${row.version}`).toString('utf8'));
    const author=this.db.prepare('SELECT display_name FROM users WHERE id=?').get(row.author_id);
    return {...body,id:row.note_id,version:row.version,authorId:row.author_id,authorName:author?.display_name||'Utente',createdAt:row.created_at,origin:'human',support:'author-contribution-not-verified-fact'};
  }
  list(tenantId,principal){
    authorizeTenant(this.db,principal,tenantId,'documents:read');
    return this.exportLatest(tenantId);
  }
  exportLatest(tenantId){
    return this.db.prepare(`SELECT r.* FROM source_notes n JOIN note_revisions r ON r.note_id=n.id AND r.version=n.version
      WHERE n.tenant_id=? ORDER BY n.updated_at DESC LIMIT 200`).all(tenantId).map(r=>this.decode(tenantId,r));
  }
  exportRevisions(tenantId){
    return this.db.prepare(`SELECT r.* FROM note_revisions r JOIN source_notes n ON n.id=r.note_id
      WHERE n.tenant_id=? ORDER BY n.created_at,r.version`).all(tenantId).map(r=>this.decode(tenantId,r));
  }
  history(tenantId,id,principal){
    authorizeTenant(this.db,principal,tenantId,'documents:read');
    assert(this.db.prepare('SELECT 1 FROM source_notes WHERE id=? AND tenant_id=?').get(id,tenantId),404,'note_not_found','Note unavailable');
    return this.db.prepare('SELECT * FROM note_revisions WHERE note_id=? ORDER BY version DESC').all(id).map(r=>this.decode(tenantId,r));
  }
  save(tenantId,id,input,principal){
    authorizeTenant(this.db,principal,tenantId,'documents:read');
    authorizeTenant(this.db,principal,tenantId,'documents:write');
    const {title,text,references,expectedVersion}=input;
    assert(typeof title==='string'&&title.trim().length>=1&&title.length<=160&&typeof text==='string'&&text.trim().length>=1&&text.length<=10000,400,'validation_error','Title and note text required within limits');
    assert(Array.isArray(references)&&references.length>=1&&references.length<=10,400,'invalid_note_sources','Select 1 to 10 source passages');
    return transaction(this.db,()=>{
      const previous=id?this.db.prepare('SELECT * FROM source_notes WHERE id=? AND tenant_id=?').get(id,tenantId):null;
      if(id)assert(previous,404,'note_not_found','Note unavailable');
      assert(previous?Number.isInteger(expectedVersion)&&expectedVersion===previous.version:expectedVersion===undefined||expectedVersion===0,409,'note_version_conflict','Reload the current revision before saving');
      assert(!previous||previous.version<100,409,'note_revision_limit','Revision limit reached');
      if(!previous)assert(this.db.prepare('SELECT COUNT(*) AS n FROM source_notes WHERE tenant_id=?').get(tenantId).n<200,413,'note_scope_limit','Note limit reached');
      const verified=[],seen=new Set();
      for(const ref of references){
        assert(ref&&typeof ref.documentId==='string'&&typeof ref.fragmentId==='string',400,'invalid_note_sources','Invalid source');
        const doc=this.db.prepare("SELECT * FROM documents WHERE id=? AND tenant_id=? AND status='stored' AND deleted_at IS NULL").get(ref.documentId,tenantId);
        assert(doc,400,'invalid_note_sources','Source unavailable in this client');
        const bundle=readExtraction(this.db,this.config,tenantId,doc.id),fragment=bundle?.fragments.find(f=>f.id===ref.fragmentId);
        assert(fragment&&bundle.sourceHash===doc.sha256,400,'invalid_note_sources','Passage unavailable');
        const key=doc.id+':'+fragment.id;if(seen.has(key))continue;seen.add(key);
        verified.push({documentId:doc.id,fragmentId:fragment.id,filename:doc.original_filename,sourceHash:doc.sha256,locator:fragment.locator});
      }
      id=id||randomUUID();const version=(previous?.version||0)+1,createdAt=new Date().toISOString();
      const body=encodeEncryptedBlob(Buffer.from(JSON.stringify({title:title.trim(),text:text.trim(),references:verified})),getTenantKey(this.db,this.config,tenantId),`note:${tenantId}:${id}:${version}`);
      if(previous)this.db.prepare('UPDATE source_notes SET version=?,updated_at=? WHERE id=?').run(version,createdAt,id);
      else this.db.prepare('INSERT INTO source_notes VALUES(?,?,?,?,?)').run(id,tenantId,version,createdAt,createdAt);
      this.db.prepare('INSERT INTO note_revisions VALUES(?,?,?,?,?)').run(id,version,body,principal.id,createdAt);
      for(const documentId of new Set(verified.map(r=>r.documentId)))this.db.prepare('INSERT INTO note_sources VALUES(?,?,?)').run(id,version,documentId);
      appendAudit(this.db,this.config.auditKey,{tenantId,actorId:principal.id,actorType:principal.type,action:previous?'note.revised':'note.created',targetType:'note',targetId:id,metadata:{version,sourceCount:verified.length}});
      return this.decode(tenantId,this.db.prepare('SELECT * FROM note_revisions WHERE note_id=? AND version=?').get(id,version));
    });
  }
}
