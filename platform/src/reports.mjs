import {AdvisorJobs} from './advisor-jobs.mjs';
import {ChecklistService} from './checklists.mjs';
import {periodReportKinds,periodSelection} from './report-period.mjs';
import {financialTable,reconcileTables} from './financial-table.mjs';
import {AssertionService} from './assertions.mjs';
import {CalculationMemory} from "./calculation-memory.mjs";
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assert} from './errors.mjs';
import {transaction} from './db.mjs';
import {authorizeTenant} from './auth.mjs';
import {NoteService} from './notes.mjs';
import {getTenantKey} from './storage.mjs';
import {encodeEncryptedBlob,decodeEncryptedBlob,sha256} from './crypto.mjs';
import {appendAudit} from './audit.mjs';
export const financialReportKinds=new Set(['pmi_bank_reconciliation','private_spend_receipts']);
export const reportTitles={advisor_analysis:'Analisi Advisor con fonti e revisione',document_dossier:'Dossier documentale',pmi_bank_reconciliation:'PMI · Riconciliazione banca e registro',private_spend_receipts:'Privato · Spese e ricevute',pmi_period_dossier:'PMI · Dossier di periodo',private_period_summary:'Privato · Riepilogo documentale di periodo',pmi_missing_documents:'PMI · Documenti mancanti',private_missing_documents:'Privato · Documenti mancanti',pmi_studio_brief:'PMI · Brief per lo studio',private_professional_brief:'Privato · Brief per il professionista'};
export function migrateReports(db){
 const dependenciesExisted=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='report_checklists'").get();
 db.exec(`CREATE TABLE IF NOT EXISTS generated_reports (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,version INTEGER NOT NULL,
 pdf BLOB NOT NULL,sha256 TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS report_sources(report_id TEXT NOT NULL REFERENCES generated_reports(id) ON DELETE CASCADE,
 document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,PRIMARY KEY(report_id,document_id));
 CREATE TABLE IF NOT EXISTS report_checklists(report_id TEXT NOT NULL REFERENCES generated_reports(id) ON DELETE CASCADE,
 checklist_id TEXT NOT NULL REFERENCES dossier_checklists(id) ON DELETE CASCADE,PRIMARY KEY(report_id,checklist_id));
 CREATE TABLE IF NOT EXISTS report_advisors(report_id TEXT PRIMARY KEY REFERENCES generated_reports(id) ON DELETE CASCADE,
 advisor_id TEXT NOT NULL REFERENCES advisor_jobs(id) ON DELETE CASCADE,snapshot_digest TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS report_series(tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,last_version INTEGER NOT NULL);`);
 // Restore only the exact checklist recorded in a completed report job.
 // Historical general dossiers already depend on every original via report_sources.
 if(!dependenciesExisted&&db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dossier_checklists'").get())db.exec(`INSERT OR IGNORE INTO report_checklists
 SELECT r.id,c.id FROM generated_reports r JOIN jobs j ON j.tenant_id=r.tenant_id AND j.type='report' AND j.status='completed'
 AND json_extract(j.output_json,'$.reportId')=r.id
 JOIN dossier_checklists c ON c.tenant_id=r.tenant_id AND c.id=json_extract(j.input_json,'$.checklistId')`);
 if(!db.prepare('PRAGMA table_info(generated_reports)').all().some(column=>column.name==='kind'))db.exec("ALTER TABLE generated_reports ADD COLUMN kind TEXT NOT NULL DEFAULT 'document_dossier'");
}
export function purgeDocumentReports(db,tenantId,documentId){db.prepare('DELETE FROM generated_reports WHERE tenant_id=? AND id IN (SELECT report_id FROM report_sources WHERE document_id=?)').run(tenantId,documentId);}
export function reportSnapshot(db,config,tenantId,input={kind:'document_dossier'}){
 assert(Object.hasOwn(reportTitles,input.kind),400,'report_type_unavailable','Report type unavailable');
 const tenant=db.prepare("SELECT name FROM tenants WHERE id=? AND status='active'").get(tenantId);assert(tenant,409,'tenant_not_active','Client unavailable');
 const documents=db.prepare(`SELECT d.id,d.original_filename AS filename,d.sha256,d.mime_type AS mimeType,
 e.status AS extractionStatus,e.fragment_count AS fragmentCount,e.parser_version AS parserVersion,e.warnings_json AS warnings
 FROM documents d LEFT JOIN document_extractions e ON e.document_id=d.id WHERE d.tenant_id=? AND d.status='stored' AND d.deleted_at IS NULL ORDER BY d.id`).all(tenantId);
 assert(documents.length<=200&&(input.kind!=='document_dossier'||documents.length>0),400,'report_scope_limit','Document scope exceeded');
 if(input.kind==='advisor_analysis'){
  assert(typeof input.advisorId==='string'&&input.advisorId.length<=120,400,'advisor_report_required','Select an Advisor answer');
  const jobs=new AdvisorJobs(db,config),row=db.prepare('SELECT * FROM advisor_jobs WHERE id=? AND tenant_id=?').get(input.advisorId,tenantId);
  assert(row&&row.status==='completed'&&row.output,409,'advisor_report_unavailable','Only completed answers can be reported');const advisor=jobs.dto(row);assert(!advisor.answer.stale,409,'advisor_report_stale','Answer context changed');
  const ids=new Set(db.prepare('SELECT document_id FROM advisor_job_sources WHERE job_id=?').all(row.id).map(x=>x.document_id));
  const snapshot={kind:input.kind,reportTitle:reportTitles[input.kind],clientName:tenant.name,advisor,documents:documents.filter(x=>ids.has(x.id)).map(({warnings,...doc})=>({...doc,warnings:JSON.parse(warnings||'[]')})),notes:[],assertions:[],checklists:[],calculations:[]};
  assert(snapshot.documents.length===ids.size,409,'advisor_report_stale','Answer source unavailable');assert(Buffer.byteLength(JSON.stringify(snapshot))<=4*1024*1024,413,'report_scope_limit','Report content exceeds limit');return {snapshot,digest:sha256(Buffer.from(JSON.stringify(snapshot)))};
 }
 if(financialReportKinds.has(input.kind)){
  const table=financialTable(db,config,tenantId,input.table);assert(table.status==='computed',400,'financial_rows_need_review','Review invalid, duplicate or formula rows before report generation',{issues:table.issues.slice(0,20),totalIssues:table.issues.length});
  let bank=null;const ids=[table.source.documentId];
  if(input.kind==='pmi_bank_reconciliation'){
   assert(typeof input.bankCalculationId==='string',400,'financial_bank_required','Select a current saved bank calculation');
   const item=new CalculationMemory(db,config).all(tenantId).find(item=>item.id===input.bankCalculationId&&item.state==='current');assert(item,400,'financial_bank_required','Bank calculation unavailable in this client');bank=item.result;assert(bank.source.documentId!==table.source.documentId,400,'financial_mapping_invalid','Bank and comparison register must be distinct sources');ids.push(bank.source.documentId);
  }
  const scope=periodSelection({...input,documentIds:ids},documents);
  if(bank){bank={...bank,movements:bank.movements.filter(row=>row.date>=scope.period.start&&row.date<=scope.period.end)};assert(bank.movements.length>0,400,'financial_bank_required','No bank movements in the selected period');}
  const snapshot={kind:input.kind,reportTitle:reportTitles[input.kind],clientName:tenant.name,period:scope.period,financial:table,reconciliation:bank?reconcileTables(table,bank):null,documents:scope.documents.map(({warnings,...doc})=>({...doc,warnings:JSON.parse(warnings||'[]')})),notes:[],assertions:[],checklists:[],calculations:[]};
  assert(Buffer.byteLength(JSON.stringify(snapshot))<=4*1024*1024,413,'report_scope_limit','Report content exceeds limit');return {snapshot,digest:sha256(Buffer.from(JSON.stringify(snapshot)))};
 }
 if(periodReportKinds.has(input.kind)){
  const scope=periodSelection(input,documents),linkedToScope=item=>item.references.length>0&&item.references.every(ref=>scope.selected.has(ref.documentId));
  const allNotes=new NoteService(db,config).exportLatest(tenantId),allAssertions=new AssertionService(db,config).current(tenantId);
  const notes=allNotes.filter(linkedToScope),assertions=allAssertions.filter(linkedToScope);
  const checklists=new ChecklistService(db,config).current(tenantId).filter(item=>item.periodStart===scope.period.start&&item.periodEnd===scope.period.end&&item.items.every(requirement=>requirement.references.every(ref=>scope.selected.has(ref.documentId))));
  const snapshot={kind:input.kind,reportTitle:reportTitles[input.kind],clientName:tenant.name,period:scope.period,documents:scope.documents.map(({warnings,...doc})=>({...doc,warnings:JSON.parse(warnings||'[]')})),notes,assertions,checklists,calculations:[],excludedContributions:{notes:allNotes.length-notes.length,assertions:allAssertions.length-assertions.length},limitations:['Period and sources explicitly selected by a person; document dates are not automatically assigned or verified.','No sums across documents: a bank entry, invoice and receipt may describe the same event.','Notes and assertions included only when all their sources are in the selected scope. Their stated context may differ from the reporting period.']};
  assert(Buffer.byteLength(JSON.stringify(snapshot))<=4*1024*1024,413,'report_scope_limit','Report content exceeds limit');return {snapshot,digest:sha256(Buffer.from(JSON.stringify(snapshot)))};
 }
 const notes=new NoteService(db,config).exportLatest(tenantId);
 const calculations=new CalculationMemory(db,config).summaries(tenantId).filter(item=>item.state==='current');
 let checklists=new ChecklistService(db,config).current(tenantId);
 if(input.kind!=='document_dossier'){assert(typeof input.checklistId==='string',400,'report_checklist_required','Select an explicit checklist');checklists=checklists.filter(item=>item.id===input.checklistId);assert(checklists.length===1,400,'report_checklist_required','Checklist unavailable in this client');}
 const selectedSources=new Set(checklists.flatMap(list=>list.items.flatMap(item=>item.references.map(ref=>ref.documentId))));
 const missingReport=['pmi_missing_documents','private_missing_documents'].includes(input.kind);
 const assertions=missingReport?[]:new AssertionService(db,config).current(tenantId);
 const snapshot={kind:input.kind,reportTitle:reportTitles[input.kind],clientName:tenant.name,assertions,checklists,calculations:missingReport?[]:calculations,documents:(missingReport?documents.filter(doc=>selectedSources.has(doc.id)):documents).map(({warnings,...d})=>({...d,warnings:JSON.parse(warnings||'[]')})),notes:missingReport?[]:notes};
 assert(Buffer.byteLength(JSON.stringify(snapshot))<=4*1024*1024,413,'report_scope_limit','Report content exceeds limit');
 return {snapshot,digest:sha256(Buffer.from(JSON.stringify(snapshot)))};
}
export function enqueueReport(db,config,tenantId,input,principal){
 authorizeTenant(db,principal,tenantId,'documents:read');authorizeTenant(db,principal,tenantId,'jobs:write');
 assert(input&&Object.hasOwn(reportTitles,input.kind),400,'report_type_unavailable','Report type unavailable');
 const {digest}=reportSnapshot(db,config,tenantId,input),id=randomUUID(),createdAt=new Date().toISOString();
 const epoch=db.prepare('SELECT access_epoch FROM tenants WHERE id=?').get(tenantId).access_epoch;
 db.prepare("INSERT INTO jobs(id,tenant_id,type,status,input_json,created_by,created_at,access_epoch,authority) VALUES(?,?,'report','queued',?,?,?,?,?)").run(id,tenantId,JSON.stringify({kind:input.kind,...(input.kind==='advisor_analysis'?{advisorId:input.advisorId}:{}),...(input.checklistId?{checklistId:input.checklistId}:{}),...(periodReportKinds.has(input.kind)||financialReportKinds.has(input.kind)?{periodStart:input.periodStart,periodEnd:input.periodEnd,...(periodReportKinds.has(input.kind)?{documentIds:input.documentIds}:{}),confirmPeriodSelection:input.confirmPeriodSelection}:{}),...(financialReportKinds.has(input.kind)?{table:input.table,...(input.kind==='pmi_bank_reconciliation'?{bankCalculationId:input.bankCalculationId}:{})}:{}),snapshotDigest:digest}),principal.id,createdAt,epoch,principal.scopes.has('platform:admin')?'platform_admin':'membership');
 appendAudit(db,config.auditKey,{tenantId,actorId:principal.id,actorType:principal.type,action:'job.queued',targetType:'job',targetId:id,metadata:{type:'report'}});return id;
}
export function renderReport(snapshot,config){return new Promise((resolve,reject)=>{
 const script=fileURLToPath(new URL('../parsers/report.py',import.meta.url)),child=spawn(config.pythonExecutable,[script],{stdio:['pipe','pipe','pipe']});
 let done=false,size=0;const chunks=[];const fail=code=>{if(done)return;done=true;clearTimeout(timer);child.kill('SIGKILL');reject(Object.assign(new Error(code),{code}));};
 const timer=setTimeout(()=>fail('report_timeout'),30000);child.on('error',()=>fail('report_renderer_unavailable'));child.stdin.on('error',()=>{});child.stderr.on('data',()=>{});
 child.stdout.on('data',chunk=>{size+=chunk.length;if(size>8*1024*1024)fail('report_output_limit');else chunks.push(chunk);});
 child.on('close',code=>{if(done)return;const pdf=Buffer.concat(chunks);if(code!==0||pdf.subarray(0,5).toString()!=='%PDF-')return fail('report_render_failed');done=true;clearTimeout(timer);resolve(pdf);});child.stdin.end(JSON.stringify(snapshot));
});}
export async function executeReport(worker,job,renderer=renderReport){
 const {db,config}=worker,input=JSON.parse(job.input_json);worker.authorized(job);
 const {snapshot,digest}=reportSnapshot(db,config,job.tenant_id,input);assert(digest===input.snapshotDigest,409,'report_inputs_changed','Archive changed; generate again');
 const series=db.prepare('SELECT last_version FROM report_series WHERE tenant_id=?').get(job.tenant_id),version=(series?.last_version||0)+1;
 const createdAt=new Date().toISOString(),generatedBy=db.prepare('SELECT display_name FROM users WHERE id=?').get(job.created_by)?.display_name||'Utente autorizzato',pdf=await renderer({...snapshot,version,createdAt,generatedBy},config);
 transaction(db,()=>{
  worker.authorized(job);assert(worker.owns(job),409,'job_lease_lost','Lease lost');assert(reportSnapshot(db,config,job.tenant_id,input).digest===digest,409,'report_inputs_changed','Archive changed; generate again');
  assert((db.prepare('SELECT last_version FROM report_series WHERE tenant_id=?').get(job.tenant_id)?.last_version||0)+1===version,409,'report_inputs_changed','A report was generated concurrently');
  const id=randomUUID(),hash=sha256(pdf),encrypted=encodeEncryptedBlob(pdf,getTenantKey(db,config,job.tenant_id),`report:${job.tenant_id}:${id}`);
  db.prepare('INSERT INTO generated_reports(id,tenant_id,version,pdf,sha256,created_by,created_at,kind) VALUES(?,?,?,?,?,?,?,?)').run(id,job.tenant_id,version,encrypted,hash,job.created_by,createdAt,input.kind);
  if(input.kind==='advisor_analysis')db.prepare('INSERT INTO report_advisors VALUES(?,?,?)').run(id,input.advisorId,digest);
  for(const checklist of snapshot.checklists)db.prepare('INSERT INTO report_checklists VALUES(?,?)').run(id,checklist.id);
  for(const doc of snapshot.documents)db.prepare('INSERT INTO report_sources VALUES(?,?)').run(id,doc.id);
  db.prepare('INSERT INTO report_series VALUES(?,?) ON CONFLICT(tenant_id) DO UPDATE SET last_version=excluded.last_version').run(job.tenant_id,version);
  db.prepare("UPDATE jobs SET status='completed',output_json=?,completed_at=?,lease_owner=NULL,lease_until=NULL WHERE id=?").run(JSON.stringify({stage:input.kind,aiExecuted:snapshot.advisor?.answer.aiExecuted===true,reportId:id,version,sourceCount:snapshot.documents.length}),createdAt,job.id);
  appendAudit(db,config.auditKey,{tenantId:job.tenant_id,actorId:job.created_by,actorType:'user',action:'report.generated',targetType:'report',targetId:id,metadata:{version,kind:input.kind,sourceCount:snapshot.documents.length,aiExecuted:snapshot.advisor?.answer.aiExecuted===true}});
 });
}
export function listReports(db,tenantId){return db.prepare('SELECT id,version,kind,created_at AS createdAt FROM generated_reports WHERE tenant_id=? ORDER BY version DESC LIMIT 100').all(tenantId);}
export function downloadReport(db,config,tenantId,id,principal){
 authorizeTenant(db,principal,tenantId,'documents:read');const row=db.prepare('SELECT * FROM generated_reports WHERE id=? AND tenant_id=?').get(id,tenantId);assert(row,404,'report_not_found','Report unavailable');
 const dependency=db.prepare('SELECT * FROM report_advisors WHERE report_id=?').get(id);if(dependency)assert(reportSnapshot(db,config,tenantId,{kind:'advisor_analysis',advisorId:dependency.advisor_id}).digest===dependency.snapshot_digest,409,'advisor_report_stale','Advisor answer or review changed; generate a new report');
 const bytes=decodeEncryptedBlob(Buffer.from(row.pdf),getTenantKey(db,config,tenantId),`report:${tenantId}:${id}`);assert(sha256(bytes)===row.sha256,409,'report_hash_mismatch','Report integrity failure');
 appendAudit(db,config.auditKey,{tenantId,actorId:principal.id,actorType:principal.type,action:'report.read',targetType:'report',targetId:id});return {bytes,filename:`${row.kind==='document_dossier'?'dossier-documentale':row.kind.replaceAll('_','-')}-v${row.version}.pdf`};
}
