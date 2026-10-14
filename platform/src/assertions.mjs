import {randomUUID} from 'node:crypto';
import {assert} from './errors.mjs';
import {transaction} from './db.mjs';
import {authorizeTenant} from './auth.mjs';
import {getTenantKey} from './storage.mjs';
import {encodeEncryptedBlob,decodeEncryptedBlob,sha256} from './crypto.mjs';
import {readExtraction} from './ingestion.mjs';
import {appendAudit} from './audit.mjs';
import {assertionIssues} from './contracts.mjs';
export function migrateAssertions(db){db.exec(`CREATE TABLE IF NOT EXISTS knowledge_assertions(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,version INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS assertion_revisions(
 assertion_id TEXT NOT NULL REFERENCES knowledge_assertions(id) ON DELETE CASCADE,version INTEGER NOT NULL,
 body BLOB NOT NULL,author_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(assertion_id,version));
 CREATE TABLE IF NOT EXISTS assertion_sources(
 assertion_id TEXT NOT NULL REFERENCES knowledge_assertions(id) ON DELETE CASCADE,
 document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,PRIMARY KEY(assertion_id,document_id));`);}
export function purgeDocumentAssertions(db,tenantId,documentId){db.prepare(`DELETE FROM knowledge_assertions WHERE tenant_id=? AND id IN(SELECT assertion_id FROM assertion_sources WHERE document_id=?)`).run(tenantId,documentId);}
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
export class AssertionService{
 constructor(db,config){this.db=db;this.config=config;}
 decode(tenantId,row){const content=JSON.parse(decodeEncryptedBlob(Buffer.from(row.body),getTenantKey(this.db,this.config,tenantId),`assertion:${tenantId}:${row.assertion_id}:${row.version}`).toString());const author=this.db.prepare('SELECT display_name FROM users WHERE id=?').get(row.author_id);return {...content,version:row.version,authorId:row.author_id,authorName:author?.display_name||'Utente'};}
 exportRevisions(tenantId){return this.db.prepare('SELECT r.* FROM assertion_revisions r JOIN knowledge_assertions a ON a.id=r.assertion_id WHERE a.tenant_id=? ORDER BY r.created_at,r.version').all(tenantId).map(row=>this.decode(tenantId,row));}
 current(tenantId){
 const items=this.db.prepare('SELECT r.* FROM knowledge_assertions a JOIN assertion_revisions r ON r.assertion_id=a.id AND r.version=a.version WHERE a.tenant_id=? ORDER BY r.created_at DESC LIMIT 200').all(tenantId).map(row=>this.decode(tenantId,row));
 const live=new Map();
 for(const item of items){
  item.sourceState='current';
  for(const ref of item.references){
   if(!live.has(ref.documentId)){const doc=this.db.prepare("SELECT sha256 FROM documents WHERE id=? AND tenant_id=? AND status='stored' AND deleted_at IS NULL").get(ref.documentId,tenantId),meta=this.db.prepare('SELECT source_sha256,parser_version FROM document_extractions WHERE document_id=? AND tenant_id=?').get(ref.documentId,tenantId),bundle=doc&&readExtraction(this.db,this.config,tenantId,ref.documentId);live.set(ref.documentId,{doc,meta,bundle});}
   const {doc,meta,bundle}=live.get(ref.documentId),fragment=bundle?.fragments.find(f=>f.id===ref.fragmentId);
   if(!doc||!fragment||doc.sha256!==ref.sourceHash||bundle.sourceHash!==ref.sourceHash||meta?.source_sha256!==ref.sourceHash||meta.parser_version!==ref.parserVersion||bundle.parserVersion!==ref.parserVersion||sha256(Buffer.from(JSON.stringify(fragment)))!==ref.fragmentHash)item.sourceState='stale';
  }
 }
 // Only flag a possible difference within the exact human-declared context.
 // This is a review signal, never a claim that the sources contradict each other.
 for(const item of items){const a=item.assertion;
 const conflicts=item.sourceState==='current'&&a.status!=='rejected'?items.filter(other=>other.id!==item.id&&other.sourceState==='current'&&other.assertion.status!=='rejected'&&other.assertion.subject_ref===a.subject_ref&&other.assertion.predicate===a.predicate&&other.context===item.context&&other.assertion.value!==a.value).map(other=>other.id):[];
 item.possibleConflicts=conflicts;item.effectiveStatus=item.sourceState==='stale'?'needs_review':conflicts.length?'conflicted':a.status;item.independentEvidence=false;
 }
 return items;
 }
 list(tenantId,principal){authorizeTenant(this.db,principal,tenantId,'documents:read');return this.current(tenantId);}
 history(tenantId,id,principal){authorizeTenant(this.db,principal,tenantId,'documents:read');assert(this.db.prepare('SELECT 1 FROM knowledge_assertions WHERE id=? AND tenant_id=?').get(id,tenantId),404,'assertion_not_found','Assertion unavailable');return this.db.prepare('SELECT * FROM assertion_revisions WHERE assertion_id=? ORDER BY version DESC').all(id).map(row=>this.decode(tenantId,row));}
 save(tenantId,id,input,principal){
 authorizeTenant(this.db,principal,tenantId,'documents:read');authorizeTenant(this.db,principal,tenantId,'documents:write');
 assert(principal.type==='user'&&this.db.prepare("SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=? AND m.user_id=? AND u.status='active'").get(tenantId,principal.id),403,'human_membership_required','Human client membership required');
 assert(input&&text(input.subject,160)&&text(input.predicate,160)&&text(input.value,2000)&&text(input.context,160)&&Array.isArray(input.references)&&input.references.length>=1&&input.references.length<=10,400,'invalid_assertion','Subject, predicate, value, explicit context and sources required');
 assert(input.status===undefined||['proposed','verified','rejected'].includes(input.status),400,'invalid_assertion','Invalid review state');
 assert(input.confidence===undefined&&input.origin===undefined&&input.assertion===undefined,400,'invalid_assertion','Origin and confidence are server controlled');
 return transaction(this.db,()=>{
 const previous=id?this.db.prepare('SELECT * FROM knowledge_assertions WHERE id=? AND tenant_id=?').get(id,tenantId):null;
 if(id)assert(previous,404,'assertion_not_found','Assertion unavailable');
 assert(previous?Number.isInteger(input.expectedVersion)&&input.expectedVersion===previous.version:input.expectedVersion===undefined||input.expectedVersion===0,409,'assertion_version_conflict','Reload current revision');
 assert(!previous||previous.version<100,413,'assertion_scope_limit','Revision limit reached');
 assert(previous||this.db.prepare('SELECT COUNT(*) n FROM knowledge_assertions WHERE tenant_id=?').get(tenantId).n<200,413,'assertion_scope_limit','Assertion limit reached');
 const status=input.status||'proposed';
 if(status!=='proposed')assert(input.confirmHumanReview===true,400,'assertion_review_confirmation_required','Explicit human review confirmation required on every new revision');
 const references=[],seen=new Set();
 for(const ref of input.references){assert(ref&&typeof ref.documentId==='string'&&typeof ref.fragmentId==='string',400,'invalid_assertion_sources','Invalid source');
 const doc=this.db.prepare("SELECT * FROM documents WHERE id=? AND tenant_id=? AND status='stored' AND deleted_at IS NULL").get(ref.documentId,tenantId),bundle=doc&&readExtraction(this.db,this.config,tenantId,doc.id),fragment=bundle?.fragments.find(f=>f.id===ref.fragmentId),meta=doc&&this.db.prepare('SELECT source_sha256,parser_version FROM document_extractions WHERE document_id=? AND tenant_id=?').get(doc.id,tenantId);
 assert(fragment&&bundle.sourceHash===doc.sha256&&meta?.source_sha256===doc.sha256&&meta.parser_version===bundle.parserVersion,400,'invalid_assertion_sources','Source unavailable in this client');
 const key=doc.id+':'+fragment.id;if(seen.has(key))continue;seen.add(key);
 references.push({documentId:doc.id,fragmentId:fragment.id,filename:doc.original_filename,sourceHash:doc.sha256,locator:fragment.locator,parserVersion:bundle.parserVersion,fragmentHash:sha256(Buffer.from(JSON.stringify(fragment)))});
 }
 id=id||randomUUID();const version=(previous?.version||0)+1,createdAt=new Date().toISOString();
 const assertion={id,tenant_id:tenantId,assertion_type:'human_statement',subject_ref:input.subject.trim(),predicate:input.predicate.trim(),value:input.value.trim(),status,confidence:null,confidence_basis:'not_measured',evidence:references.map(ref=>({source_object_id:ref.documentId,document_version_id:ref.sourceHash,fragment_id:ref.fragmentId,lineage_id:ref.fragmentHash,page:ref.locator.page||null})),origin:{kind:'human',component:'attributed-assertion-review',component_version:'0.1.0'},contract_version:'1.1.0',created_at:createdAt,review_status:status==='verified'?'approved':status==='rejected'?'rejected':'pending'};
 assert(assertionIssues(assertion).length===0,500,'assertion_contract_invalid','Assertion contract validation failed');
 const item={id,assertion,context:input.context.trim(),references,review:status==='proposed'?null:{by:principal.id,at:createdAt,meaning:'human-confirmation-not-model-accuracy'}};
 const content=Buffer.from(JSON.stringify(item));assert(content.length<=100000,413,'assertion_scope_limit','Assertion too large');
 const stored=this.db.prepare('SELECT COALESCE(SUM(length(r.body)),0) n FROM assertion_revisions r JOIN knowledge_assertions a ON a.id=r.assertion_id WHERE a.tenant_id=?').get(tenantId).n;assert(stored+content.length+64<=16*1024*1024,413,'assertion_scope_limit','History size limit reached');
 const body=encodeEncryptedBlob(content,getTenantKey(this.db,this.config,tenantId),`assertion:${tenantId}:${id}:${version}`);
 if(previous)this.db.prepare('UPDATE knowledge_assertions SET version=? WHERE id=?').run(version,id);else this.db.prepare('INSERT INTO knowledge_assertions VALUES(?,?,?)').run(id,tenantId,version);
 this.db.prepare('INSERT INTO assertion_revisions VALUES(?,?,?,?,?)').run(id,version,body,principal.id,createdAt);
 for(const docId of new Set(references.map(ref=>ref.documentId)))this.db.prepare('INSERT OR IGNORE INTO assertion_sources VALUES(?,?)').run(id,docId);
 appendAudit(this.db,this.config.auditKey,{tenantId,actorId:principal.id,actorType:principal.type,action:previous?'assertion.revised':'assertion.created',targetType:'assertion',targetId:id,metadata:{version,reviewState:status,sourceCount:references.length}});
 return this.current(tenantId).find(item=>item.id===id);
 });
 }
}
