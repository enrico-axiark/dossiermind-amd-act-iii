import {randomUUID} from 'node:crypto';
import {transaction} from './db.mjs';
import {assert} from './errors.mjs';
import {authorizeTenant} from './auth.mjs';
import {bankSummary} from './calculations.mjs';
import {readExtraction} from './ingestion.mjs';
import {sha256,encodeEncryptedBlob,decodeEncryptedBlob} from './crypto.mjs';
import {getTenantKey} from './storage.mjs';
import {appendAudit} from './audit.mjs';
import {derivedArtifactSchema,schemaIssues} from './contracts.mjs';
const VERSION='0.1.0';
export function migrateCalculationMemory(db){db.exec(`CREATE TABLE IF NOT EXISTS calculation_memories(
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,version INTEGER NOT NULL,
 fingerprint TEXT NOT NULL,parameters_hash TEXT NOT NULL,body BLOB NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(tenant_id,document_id,version));`);}
export function purgeDocumentCalculations(db,tenantId,documentId){db.prepare('DELETE FROM calculation_memories WHERE tenant_id=? AND document_id=?').run(tenantId,documentId);}
function sourceFingerprint(db,config,tenantId,documentId){
 const doc=db.prepare("SELECT sha256 FROM documents WHERE id=? AND tenant_id=? AND status='stored' AND deleted_at IS NULL").get(documentId,tenantId);
 const bundle=readExtraction(db,config,tenantId,documentId),extraction=db.prepare('SELECT parser_version,source_sha256 FROM document_extractions WHERE document_id=? AND tenant_id=?').get(documentId,tenantId);
 if(!doc||!bundle||doc.sha256!==bundle.sourceHash||extraction?.source_sha256!==doc.sha256||extraction.parser_version!==bundle.parserVersion)return null;
 return sha256(Buffer.from(JSON.stringify({sourceHash:bundle.sourceHash,parserVersion:bundle.parserVersion,fragments:bundle.fragments})));
}
export class CalculationMemory {
 constructor(db,config){this.db=db;this.config=config;}
 decode(row){const body=JSON.parse(decodeEncryptedBlob(Buffer.from(row.body),getTenantKey(this.db,this.config,row.tenant_id),`calculation:${row.tenant_id}:${row.id}`).toString());
  assert(schemaIssues(body.artifact,derivedArtifactSchema).length===0,409,'memory_contract_invalid','Invalid derived artifact');
  const author=this.db.prepare('SELECT display_name FROM users WHERE id=?').get(row.created_by);
  return {id:row.id,version:row.version,createdAt:row.created_at,authorName:author?.display_name||'Utente',...body};
 }
 all(tenantId){
  const rows=this.db.prepare('SELECT * FROM calculation_memories WHERE tenant_id=? ORDER BY document_id,version DESC').iterate(tenantId),fingerprints=new Map(),latest=new Set();
  const results=[];for(const row of rows){
   if(!fingerprints.has(row.document_id))fingerprints.set(row.document_id,sourceFingerprint(this.db,this.config,tenantId,row.document_id));
   const current=!latest.has(row.document_id);latest.add(row.document_id);
   results.push({...this.decode(row),state:fingerprints.get(row.document_id)!==row.fingerprint?'stale':current?'current':'superseded'});
  }return results;
 }
 summaries(tenantId){
  const rows=this.db.prepare(`SELECT c.* FROM calculation_memories c WHERE c.tenant_id=? AND c.version=(SELECT MAX(x.version) FROM calculation_memories x WHERE x.tenant_id=c.tenant_id AND x.document_id=c.document_id) ORDER BY c.created_at DESC LIMIT 20`).iterate(tenantId),items=[];
  for(const row of rows){const value=this.decode(row),{movements,...result}=value.result;
   items.push({id:value.id,version:value.version,createdAt:value.createdAt,authorName:value.authorName,state:sourceFingerprint(this.db,this.config,tenantId,row.document_id)===row.fingerprint?'current':'stale',result:{...result,discrepancies:result.discrepancies.slice(0,20),discrepancyCount:result.discrepancies.length,movementCount:movements.length},lineageId:value.artifact.lineage_id,independentEvidence:false,reviewStatus:value.artifact.review_status,contentRef:value.artifact.content_ref});
  }return items;
 }
 list(tenantId,principal){authorizeTenant(this.db,principal,tenantId,'documents:read');return this.summaries(tenantId);}
 get(tenantId,id,principal){authorizeTenant(this.db,principal,tenantId,'documents:read');const row=this.db.prepare('SELECT * FROM calculation_memories WHERE id=? AND tenant_id=?').get(id,tenantId);assert(row,404,'calculation_memory_not_found','Saved calculation unavailable');const latest=this.db.prepare('SELECT MAX(version) version FROM calculation_memories WHERE tenant_id=? AND document_id=?').get(tenantId,row.document_id).version;return {...this.decode(row),state:sourceFingerprint(this.db,this.config,tenantId,row.document_id)!==row.fingerprint?'stale':latest===row.version?'current':'superseded'};}

 save(tenantId,input,principal){
  authorizeTenant(this.db,principal,tenantId,'documents:read');authorizeTenant(this.db,principal,tenantId,'documents:write');
  return transaction(this.db,()=>{
   const parameters={documentId:input?.documentId,columns:Object.fromEntries(['date','id','description','debit','credit','balance'].map(key=>[key,input?.columns?.[key]])),currency:input?.currency,numberFormat:input?.numberFormat,balancePosition:input?.balancePosition};
   const result=bankSummary(this.db,this.config,tenantId,parameters,principal);assert(result.totals,409,'calculation_needs_review','Resolve source problems before saving');
   const fingerprint=sourceFingerprint(this.db,this.config,tenantId,input.documentId);assert(fingerprint,409,'calculation_source_unavailable','Source version is inconsistent');
   const parametersHash=sha256(Buffer.from(JSON.stringify({parameters,componentVersion:VERSION})));
   const previous=this.db.prepare('SELECT * FROM calculation_memories WHERE tenant_id=? AND document_id=? ORDER BY version DESC LIMIT 1').get(tenantId,input.documentId);
   if(previous?.fingerprint===fingerprint&&previous.parameters_hash===parametersHash)return {...this.decode(previous),state:'current',reused:true};
   assert(previous||this.db.prepare('SELECT COUNT(DISTINCT document_id) n FROM calculation_memories WHERE tenant_id=?').get(tenantId).n<20,413,'calculation_memory_limit','Use at most 20 calculated documents');
   assert((previous?.version||0)<20&&this.db.prepare('SELECT COUNT(*) n FROM calculation_memories WHERE tenant_id=?').get(tenantId).n<200,413,'calculation_memory_limit','Calculation history limit reached');
   const id=randomUUID(),version=(previous?.version||0)+1,createdAt=new Date().toISOString();
   const artifact={id,tenant_id:tenantId,artifact_type:'summary',lineage_id:`source:${input.documentId}:${result.source.sourceHash}`,evidence_ids:result.movements.map(m=>m.reference.fragmentId),content_ref:`sqlite:calculation_memories:${id}`,generation:{component:'exact-bank-summary',component_version:VERSION,contract_version:'1.0.0',model_id:null,prompt_template_version:null},policy_version:'act-iii-conditional-calculation-1',created_at:createdAt,review_status:'pending',independent_evidence:false,supersedes_id:previous?.id||null,manifest_hash:sha256(Buffer.from(JSON.stringify({parameters,result,fingerprint})))};
   assert(schemaIssues(artifact,derivedArtifactSchema).length===0,409,'memory_contract_invalid','Invalid generated artifact');
   const body=Buffer.from(JSON.stringify({artifact,parameters,result}));assert(body.length<=8*1024*1024,413,'calculation_memory_limit','Calculation content exceeds limit');
   assert((this.db.prepare('SELECT COALESCE(SUM(length(body)),0) bytes FROM calculation_memories WHERE tenant_id=?').get(tenantId).bytes+body.length+28)<=32*1024*1024,413,'calculation_memory_limit','Calculation history storage limit reached');
   const encrypted=encodeEncryptedBlob(body,getTenantKey(this.db,this.config,tenantId),`calculation:${tenantId}:${id}`);
   this.db.prepare('INSERT INTO calculation_memories VALUES(?,?,?,?,?,?,?,?,?)').run(id,tenantId,input.documentId,version,fingerprint,parametersHash,encrypted,principal.id,createdAt);
   appendAudit(this.db,this.config.auditKey,{tenantId,actorId:principal.id,actorType:principal.type,action:'calculation.saved',targetType:'derived_artifact',targetId:id,metadata:{version,independentEvidence:false}});
   return {...this.decode(this.db.prepare('SELECT * FROM calculation_memories WHERE id=?').get(id)),state:'current',reused:false};
  });
 }
}
