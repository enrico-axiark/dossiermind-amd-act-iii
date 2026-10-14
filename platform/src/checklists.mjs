import {randomUUID} from 'node:crypto';
import {assert} from './errors.mjs';
import {transaction} from './db.mjs';
import {authorizeTenant} from './auth.mjs';
import {getTenantKey} from './storage.mjs';
import {encodeEncryptedBlob,decodeEncryptedBlob,sha256} from './crypto.mjs';
import {readExtraction} from './ingestion.mjs';
import {appendAudit} from './audit.mjs';

export function migrateChecklists(db){db.exec(`CREATE TABLE IF NOT EXISTS dossier_checklists(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,version INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS checklist_revisions(
 checklist_id TEXT NOT NULL REFERENCES dossier_checklists(id) ON DELETE CASCADE,version INTEGER NOT NULL,
 body BLOB NOT NULL,author_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(checklist_id,version));
 CREATE TABLE IF NOT EXISTS checklist_sources(
 checklist_id TEXT NOT NULL REFERENCES dossier_checklists(id) ON DELETE CASCADE,
 document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,PRIMARY KEY(checklist_id,document_id));`);}

// Remove every revision of a linked checklist, including superseded sensitive content.
export function purgeDocumentChecklists(db,tenantId,documentId){
 db.prepare(`DELETE FROM generated_reports WHERE tenant_id=? AND id IN
 (SELECT rc.report_id FROM report_checklists rc JOIN checklist_sources cs ON cs.checklist_id=rc.checklist_id WHERE cs.document_id=?)`).run(tenantId,documentId);
 db.prepare(`DELETE FROM dossier_checklists WHERE tenant_id=? AND id IN(SELECT checklist_id FROM checklist_sources WHERE document_id=?)`).run(tenantId,documentId);
}
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export class ChecklistService{
 constructor(db,config){this.db=db;this.config=config;}
 decode(tenantId,row){
  const body=JSON.parse(decodeEncryptedBlob(Buffer.from(row.body),getTenantKey(this.db,this.config,tenantId),`checklist:${tenantId}:${row.checklist_id}:${row.version}`).toString());
  const author=this.db.prepare('SELECT display_name FROM users WHERE id=?').get(row.author_id);
  return {...body,id:row.checklist_id,version:row.version,authorId:row.author_id,authorName:author?.display_name||'Utente',createdAt:row.created_at,origin:'human_explicit_requirements',independentEvidence:false};
 }
 exportRevisions(tenantId){return this.db.prepare(`SELECT r.* FROM checklist_revisions r JOIN dossier_checklists c ON c.id=r.checklist_id WHERE c.tenant_id=? ORDER BY r.created_at,r.version`).all(tenantId).map(r=>this.decode(tenantId,r));}
 current(tenantId){
  const rows=this.db.prepare(`SELECT r.* FROM dossier_checklists c JOIN checklist_revisions r ON r.checklist_id=c.id AND r.version=c.version WHERE c.tenant_id=? ORDER BY r.created_at DESC LIMIT 20`).all(tenantId);
  const sources=new Map();
  const source=id=>{if(!sources.has(id)){const doc=this.db.prepare("SELECT sha256 FROM documents WHERE id=? AND tenant_id=? AND status='stored' AND deleted_at IS NULL").get(id,tenantId),extraction=this.db.prepare('SELECT parser_version,source_sha256 FROM document_extractions WHERE document_id=? AND tenant_id=?').get(id,tenantId),bundle=doc&&readExtraction(this.db,this.config,tenantId,id);sources.set(id,doc&&bundle&&extraction?.source_sha256===doc.sha256&&extraction.parser_version===bundle.parserVersion?{doc,bundle,fragments:new Map(bundle.fragments.map(fragment=>[fragment.id,fragment]))}:null);}return sources.get(id);};
  return rows.map(row=>{
   const item=this.decode(tenantId,row);
   item.items=item.items.map(requirement=>{
    const valid=requirement.references.every(ref=>{
     const live=source(ref.documentId),fragment=live?.fragments.get(ref.fragmentId);
     return !!fragment&&live.doc.sha256===ref.sourceHash&&live.bundle.sourceHash===ref.sourceHash&&live.bundle.parserVersion===ref.parserVersion&&sha256(Buffer.from(JSON.stringify(fragment)))===ref.fragmentHash;
    });
    const reviewer=requirement.reviewedBy&&this.db.prepare('SELECT display_name FROM users WHERE id=?').get(requirement.reviewedBy);
    return {...requirement,...(reviewer?{reviewerName:reviewer.display_name}:{}),...(!valid?{status:'needs_review',reason:'source_changed'}:{})};
   });
   item.counts=Object.fromEntries(['missing','received','reviewed','needs_review'].map(status=>[status,item.items.filter(i=>i.status===status).length]));
   return item;
  });
 }
 list(tenantId,principal){authorizeTenant(this.db,principal,tenantId,'documents:read');return this.current(tenantId);}
 history(tenantId,id,principal){authorizeTenant(this.db,principal,tenantId,'documents:read');assert(this.db.prepare('SELECT 1 FROM dossier_checklists WHERE id=? AND tenant_id=?').get(id,tenantId),404,'checklist_not_found','Checklist unavailable');return this.db.prepare('SELECT * FROM checklist_revisions WHERE checklist_id=? ORDER BY version DESC').all(id).map(row=>this.decode(tenantId,row));}
 save(tenantId,id,input,principal){
  authorizeTenant(this.db,principal,tenantId,'documents:read');authorizeTenant(this.db,principal,tenantId,'documents:write');
  assert(input&&typeof input.title==='string'&&input.title.trim()&&input.title.length<=160&&date(input.periodStart)&&date(input.periodEnd)&&input.periodStart<=input.periodEnd,400,'invalid_checklist','Title and valid period required');
  assert(Array.isArray(input.items)&&input.items.length>=1&&input.items.length<=100,400,'invalid_checklist','Use 1 to 100 explicit requirements');
  return transaction(this.db,()=>{
   const previous=id?this.db.prepare('SELECT * FROM dossier_checklists WHERE id=? AND tenant_id=?').get(id,tenantId):null;
   if(id)assert(previous,404,'checklist_not_found','Checklist unavailable');
   assert(previous?input.expectedVersion===previous.version:input.expectedVersion===undefined||input.expectedVersion===0,409,'checklist_version_conflict','Reload current revision');
   assert(!previous||previous.version<100,413,'checklist_scope_limit','Revision limit reached');
   assert(previous||this.db.prepare('SELECT COUNT(*) n FROM dossier_checklists WHERE tenant_id=?').get(tenantId).n<20,413,'checklist_scope_limit','Checklist limit reached');
   const previousBody=previous?this.decode(tenantId,this.db.prepare('SELECT * FROM checklist_revisions WHERE checklist_id=? AND version=?').get(id,previous.version)):null;
   const items=[],ids=new Set(),documents=new Set();
   for(const entry of input.items){
    assert(entry&&typeof entry.requirement==='string'&&entry.requirement.trim()&&entry.requirement.length<=500&&['missing','received','reviewed'].includes(entry.status)&&Array.isArray(entry.references)&&entry.references.length<=10,400,'invalid_checklist','Explicit requirement, status and references required');
    const itemId=entry.id||randomUUID();assert(typeof itemId==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(itemId)&&!ids.has(itemId),400,'invalid_checklist','Unique requirement IDs required');ids.add(itemId);
    assert(entry.status==='missing'?entry.references.length===0:entry.references.length>0,400,'invalid_checklist_sources','Received or reviewed items need evidence; missing items have no evidence');

    const references=[];
    for(const ref of entry.references){
     assert(ref&&typeof ref.documentId==='string'&&typeof ref.fragmentId==='string',400,'invalid_checklist_sources','Invalid source');
     const doc=this.db.prepare("SELECT * FROM documents WHERE id=? AND tenant_id=? AND status='stored' AND deleted_at IS NULL").get(ref.documentId,tenantId);
     const bundle=doc&&readExtraction(this.db,this.config,tenantId,doc.id),fragment=bundle?.fragments.find(f=>f.id===ref.fragmentId);
     const extraction=doc&&this.db.prepare('SELECT parser_version,source_sha256 FROM document_extractions WHERE document_id=? AND tenant_id=?').get(doc.id,tenantId);
     assert(fragment&&bundle.sourceHash===doc.sha256&&extraction?.source_sha256===doc.sha256&&extraction.parser_version===bundle.parserVersion,400,'invalid_checklist_sources','Source passage unavailable in this client');
     references.push({documentId:doc.id,fragmentId:fragment.id,filename:doc.original_filename,sourceHash:doc.sha256,locator:fragment.locator,parserVersion:bundle.parserVersion,fragmentHash:sha256(Buffer.from(JSON.stringify(fragment)))});documents.add(doc.id);
    }
    const old=previousBody?.items.find(item=>item.id===itemId);
    const unchangedReview=old?.status==='reviewed'&&old.requirement===entry.requirement.trim()&&JSON.stringify(old.references)===JSON.stringify(references)&&previousBody.periodStart===input.periodStart&&previousBody.periodEnd===input.periodEnd;
    assert(entry.status!=='reviewed'||unchangedReview||input.confirmHumanReview===true,400,'checklist_review_confirmation_required','Confirm human verification explicitly');
    items.push({id:itemId,requirement:entry.requirement.trim(),status:entry.status,references,...(entry.status==='reviewed'?(unchangedReview?{reviewedBy:old.reviewedBy,reviewedAt:old.reviewedAt}:{reviewedBy:principal.id,reviewedAt:new Date().toISOString()}):{})});
   }
   id=id||randomUUID();const version=(previous?.version||0)+1,createdAt=new Date().toISOString();
   const content=Buffer.from(JSON.stringify({title:input.title.trim(),periodStart:input.periodStart,periodEnd:input.periodEnd,items}));
   assert(content.length<=200000,413,'checklist_scope_limit','Checklist too large');
   const stored=this.db.prepare('SELECT COALESCE(SUM(length(r.body)),0) n FROM checklist_revisions r JOIN dossier_checklists c ON c.id=r.checklist_id WHERE c.tenant_id=?').get(tenantId).n;
   assert(stored+content.length+64<=16*1024*1024,413,'checklist_scope_limit','History size limit reached');
   const body=encodeEncryptedBlob(content,getTenantKey(this.db,this.config,tenantId),`checklist:${tenantId}:${id}:${version}`);
   if(previous)this.db.prepare('UPDATE dossier_checklists SET version=? WHERE id=?').run(version,id);else this.db.prepare('INSERT INTO dossier_checklists VALUES(?,?,?)').run(id,tenantId,version);
   this.db.prepare('INSERT INTO checklist_revisions VALUES(?,?,?,?,?)').run(id,version,body,principal.id,createdAt);
   for(const docId of documents)this.db.prepare('INSERT OR IGNORE INTO checklist_sources VALUES(?,?)').run(id,docId);
   appendAudit(this.db,this.config.auditKey,{tenantId,actorId:principal.id,actorType:principal.type,action:previous?'checklist.revised':'checklist.created',targetType:'checklist',targetId:id,metadata:{version,itemCount:items.length}});
   return this.current(tenantId).find(item=>item.id===id);
  });
 }
}
