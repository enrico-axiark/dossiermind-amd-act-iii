import {assert} from './errors.mjs';
import {sha256} from './crypto.mjs';

// Describe the full stored dependency closure, including superseded revisions.
// No document text, review bodies, storage paths or credentials leave this API.
export function documentDeletionManifest(db,tenantId,documentId){
 const doc=db.prepare("SELECT id,original_filename,sha256,status FROM documents WHERE tenant_id=? AND id=? AND deleted_at IS NULL").get(tenantId,documentId);
 assert(doc,404,'document_not_found','Document not found');
 const ids=(sql,...args)=>db.prepare(sql).all(...args).map(r=>r.id).sort();
 const linked=(table,sources,key)=>ids(`SELECT id FROM ${table} WHERE tenant_id=? AND id IN(SELECT ${key} FROM ${sources} WHERE document_id=?)`,tenantId,documentId);
 const notes=linked('source_notes','note_sources','note_id'),checklists=linked('dossier_checklists','checklist_sources','checklist_id'),assertions=linked('knowledge_assertions','assertion_sources','assertion_id');
 const advisor=linked('advisor_jobs','advisor_job_sources','job_id'),memory=ids('SELECT id FROM memory_requests WHERE tenant_id=? AND document_id=?',tenantId,documentId);
 const calculations=ids('SELECT id FROM calculation_memories WHERE tenant_id=? AND document_id=?',tenantId,documentId);
 const reportSet=new Set(linked('generated_reports','report_sources','report_id'));
 for(const id of checklists)for(const report of ids('SELECT r.id FROM generated_reports r JOIN report_checklists c ON c.report_id=r.id WHERE r.tenant_id=? AND c.checklist_id=?',tenantId,id))reportSet.add(report);
 for(const id of advisor)for(const report of ids('SELECT r.id FROM generated_reports r JOIN report_advisors a ON a.report_id=r.id WHERE r.tenant_id=? AND a.advisor_id=?',tenantId,id))reportSet.add(report);
 const revisions=(table,key,items)=>items.reduce((sum,id)=>sum+db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${key}=?`).get(id).n,0);
 const extraction=db.prepare('SELECT fragment_count FROM document_extractions WHERE tenant_id=? AND document_id=?').get(tenantId,documentId);
 const holds=db.prepare('SELECT id FROM legal_holds WHERE tenant_id=? AND active=1 ORDER BY id').all(tenantId).map(r=>r.id);
 const manifest={schemaVersion:1,document:{id:doc.id,filename:doc.original_filename,sourceHash:doc.sha256,status:doc.status},blocked:holds.length>0,activeHoldCount:holds.length,
  affected:{originals:1,extractions:extraction?1:0,fragments:extraction?.fragment_count||0,notes,noteRevisions:revisions('note_revisions','note_id',notes),checklists,checklistRevisions:revisions('checklist_revisions','checklist_id',checklists),assertions,assertionRevisions:revisions('assertion_revisions','assertion_id',assertions),calculations,advisorRequests:advisor,advisorReviews:revisions('advisor_reviews','job_id',advisor),memoryRequests:memory,memoryReviews:revisions('memory_reviews','request_id',memory),reports:[...reportSet].sort()},
  retained:['Minimal document tombstone, technical job history, dispatch ledger and audit records; no deleted source text or derived bodies in this manifest.','Copies previously downloaded or backed up are outside this deletion.']};
 return {...manifest,manifestSha256:sha256(Buffer.from(JSON.stringify(manifest)))};
}
