import {sourceGraph} from "../src/retrieval.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPlatformApp} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {IngestionWorker} from '../src/ingestion.mjs';
import {renderReport,listReports,downloadReport,reportSnapshot} from '../src/reports.mjs';
import {NoteService} from '../src/notes.mjs';
import {AssertionService} from '../src/assertions.mjs';
import {spawnSync} from 'node:child_process';
const admin={id:'admin',type:'user',scopes:new Set(['platform:admin'])},user={id:'owner',type:'user',scopes:new Set(),claimedTenantIds:new Set()};
async function setup(){const dir=mkdtempSync(join(tmpdir(),'dm-report-')),config=loadConfig({nodeEnv:'test',baseDir:dir,dbPath:'db.sqlite',storageRoot:join(dir,'objects'),masterKey:randomBytes(32),auditKey:randomBytes(32),pythonExecutable:process.env.PYTHON_EXECUTABLE||'python3'}),app=createPlatformApp(config),org=app.service.createOrganization({name:'Synthetic',type:'pmi'},admin),tenant=app.service.createTenant({organizationId:org.id,name:'Aurora - test sintetico'},admin);
 app.service.createUser({id:user.id,email:'owner@example.test',displayName:'Cliente sintetico'},admin);app.service.addMembership(tenant.id,{userId:user.id,role:'owner',scopes:['documents:read','documents:write','jobs:write','jobs:read']},admin);
 const doc=app.service.uploadDocument(tenant.id,{filename:'costs.csv',mimeType:'text/csv',bytes:Buffer.from('Servizio,Importo\nNewsletter,80\n')},user);app.service.createJob(tenant.id,{type:'ingestion',input:{documentIds:[doc.id]}},user);await new IngestionWorker(app.db,config).tick();
 const fragment=app.service.getFragments(tenant.id,doc.id).fragments[0];new NoteService(app.db,config).save(tenant.id,null,{title:'Verifica condizioni',text:'Preavviso e penali da verificare. <b>Questo testo resta letterale.</b>',references:[{documentId:doc.id,fragmentId:fragment.id}]},user);
 return {...app,dir,config,tenant,doc,close(){app.db.close();rmSync(dir,{recursive:true,force:true});}};}
const enqueue=x=>x.service.createJob(x.tenant.id,{type:'report',input:{kind:'document_dossier'}},user);
const periodInput=x=>({kind:'pmi_period_dossier',periodStart:'2026-09-01',periodEnd:'2026-09-30',documentIds:[x.doc.id],confirmPeriodSelection:true});
test('both period reports require explicit valid dates, live selected originals and human confirmation',async()=>{
 const x=await setup();try{
  const input=periodInput(x);for(const kind of ['pmi_period_dossier','private_period_summary'])assert.equal(reportSnapshot(x.db,x.config,x.tenant.id,{...input,kind}).snapshot.period.datesAutomaticallyVerified,false);
  for(const patch of [{periodStart:'2026-02-30'},{periodEnd:'2026-08-31'},{periodStart:'09/01/2026'}])assert.throws(()=>reportSnapshot(x.db,x.config,x.tenant.id,{...input,...patch}),e=>e.code==='report_period_invalid');
  assert.throws(()=>reportSnapshot(x.db,x.config,x.tenant.id,{...input,confirmPeriodSelection:false}),e=>e.code==='report_period_confirmation_required');
  for(const documentIds of [[],[x.doc.id,x.doc.id]])assert.throws(()=>reportSnapshot(x.db,x.config,x.tenant.id,{...input,documentIds}),e=>e.code==='report_documents_required');
  const other=x.service.createTenant({organizationId:x.service.createOrganization({name:'Other synthetic',type:'pmi'},admin).id,name:'Other client'},admin),outside=x.service.uploadDocument(other.id,{filename:'other-client.csv',mimeType:'text/csv',bytes:Buffer.from('A,B\n1,2\n')},admin);
  assert.throws(()=>reportSnapshot(x.db,x.config,x.tenant.id,{...input,documentIds:[outside.id]}),e=>e.code==='report_source_unavailable');
 }finally{x.close();}
});
test('period snapshot excludes unselected sources and cross-source contributions, without summing duplicated event representations',async()=>{
 const x=await setup();try{
  const second=x.service.uploadDocument(x.tenant.id,{filename:'receipt.csv',mimeType:'text/csv',bytes:Buffer.from('Ricevuta,Importo\nNewsletter,80\n')},user);x.service.createJob(x.tenant.id,{type:'ingestion',input:{documentIds:[second.id]}},user);await new IngestionWorker(x.db,x.config).tick();
  const notes=new NoteService(x.db,x.config),firstRef={documentId:x.doc.id,fragmentId:x.service.getFragments(x.tenant.id,x.doc.id).fragments[0].id},secondRef={documentId:second.id,fragmentId:x.service.getFragments(x.tenant.id,second.id).fragments[0].id};notes.save(x.tenant.id,null,{title:'Two originals',text:'The same event may appear twice.',references:[firstRef,secondRef]},user);
  new AssertionService(x.db,x.config).save(x.tenant.id,null,{subject:'Newsletter',predicate:'Costo',value:'80 EUR',context:'September',references:[secondRef]},user);
  let {snapshot}=reportSnapshot(x.db,x.config,x.tenant.id,periodInput(x));assert.deepEqual(snapshot.documents.map(d=>d.id),[x.doc.id]);assert.equal(snapshot.notes.length,1);assert.equal(snapshot.excludedContributions.notes,1);assert.equal(snapshot.assertions.length,0);assert.equal(snapshot.excludedContributions.assertions,1);assert.deepEqual(snapshot.calculations,[]);
  snapshot=reportSnapshot(x.db,x.config,x.tenant.id,{...periodInput(x),documentIds:[x.doc.id,second.id]}).snapshot;assert.equal(snapshot.documents.length,2);assert.equal(snapshot.notes.length,2);assert.equal(snapshot.assertions.length,1);assert.deepEqual(snapshot.calculations,[]);assert.equal(snapshot.totals,undefined);
 }finally{x.close();}
});
test('period PDF preserves dates and only selected lineage; deleting an unselected original preserves it',async()=>{
 const x=await setup();try{
  const unselected=x.service.uploadDocument(x.tenant.id,{filename:'excluded.csv',mimeType:'text/csv',bytes:Buffer.from('A,B\n1,2\n')},user),job=x.service.createJob(x.tenant.id,{type:'report',input:{...periodInput(x),kind:'private_period_summary'}},user);await new IngestionWorker(x.db,x.config).tick();const result=x.service.getJob(x.tenant.id,job.id);assert.equal(result.status,'completed');assert.equal(result.output.aiExecuted,false);assert.equal(result.output.sourceCount,1);
  const pdf=downloadReport(x.db,x.config,x.tenant.id,result.output.reportId,user).bytes,read=spawnSync(x.config.pythonExecutable,['-c','import sys,io;from pypdf import PdfReader;print("\\n".join(p.extract_text() for p in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages))'],{input:pdf,encoding:'utf8'});assert.equal(read.status,0,read.stderr);assert.match(read.stdout,/2026-09-01 - 2026-09-30/);assert.match(read.stdout,/costs.csv/);assert.equal(read.stdout.includes('excluded.csv'),false);assert.match(read.stdout,/non vengono sommati/);
  if(process.env.PERIOD_REPORT_PROOF_PATH)writeFileSync(process.env.PERIOD_REPORT_PROOF_PATH,pdf);
  x.service.deleteDocument(x.tenant.id,unselected.id,admin);assert.equal(listReports(x.db,x.tenant.id).length,1);x.service.deleteDocument(x.tenant.id,x.doc.id,admin);assert.equal(listReports(x.db,x.tenant.id).length,0);
 }finally{x.close();}
});
test('period report rejects a source removed before rendering and authorization revoked during rendering',async()=>{
 const x=await setup();try{
  const job=x.service.createJob(x.tenant.id,{type:'report',input:periodInput(x)},user);x.service.deleteDocument(x.tenant.id,x.doc.id,admin);await new IngestionWorker(x.db,x.config).tick();assert.equal(x.service.getJob(x.tenant.id,job.id).errorCode,'report_source_unavailable');assert.equal(listReports(x.db,x.tenant.id).length,0);
 }finally{x.close();}
 const y=await setup();try{
  const job=y.service.createJob(y.tenant.id,{type:'report',input:periodInput(y)},user),renderer=async(...args)=>{const pdf=await renderReport(...args);y.service.revokeMembership(y.tenant.id,user.id,admin);return pdf;};await new IngestionWorker(y.db,y.config,{reportRenderer:renderer}).tick();assert.equal(y.service.getJob(y.tenant.id,job.id).status,'cancelled');assert.equal(listReports(y.db,y.tenant.id).length,0);
 }finally{y.close();}
});
test('real PDF preserves human assertion review, source and differences without exposing technical identifiers',async()=>{
 const x=await setup();try{
  const claims=new AssertionService(x.db,x.config),fragment=x.service.getFragments(x.tenant.id,x.doc.id).fragments[0],input={subject:'Newsletter',predicate:'Costo dichiarato',value:'80 EUR',context:'Periodo sintetico',references:[{documentId:x.doc.id,fragmentId:fragment.id}],status:'verified',confirmHumanReview:true};
  const first=claims.save(x.tenant.id,null,input,user);claims.save(x.tenant.id,null,{...input,value:'90 EUR',status:'proposed',confirmHumanReview:false},user);
  const job=enqueue(x);await new IngestionWorker(x.db,x.config).tick();const result=x.service.getJob(x.tenant.id,job.id);assert.equal(result.status,'completed');
  const pdf=downloadReport(x.db,x.config,x.tenant.id,result.output.reportId,user).bytes;
  const read=spawnSync(x.config.pythonExecutable,['-c','import sys,io;from pypdf import PdfReader;print("\\n".join(p.extract_text() for p in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages))'],{input:pdf,encoding:'utf8'});assert.equal(read.status,0,read.stderr);
  assert.match(read.stdout,/Affermazioni e revisioni umane/);assert.match(read.stdout,/Possibile differenza da verificare/);assert.match(read.stdout,/80 EUR/);assert.match(read.stdout,/90 EUR/);assert.match(read.stdout,/costs.csv/);assert.match(read.stdout,/Cliente sintetico/);assert.match(read.stdout,/non prove indipendenti/);assert.equal(read.stdout.includes(first.id),false);assert.equal(read.stdout.includes(x.doc.sha256),false);
  if(process.env.ASSERTION_REPORT_PROOF_PATH)writeFileSync(process.env.ASSERTION_REPORT_PROOF_PATH,pdf);
 }finally{x.close();}
});
test('changed human assertion during PDF rendering rejects the outdated snapshot',async()=>{
 const x=await setup();try{
  const claims=new AssertionService(x.db,x.config),fragment=x.service.getFragments(x.tenant.id,x.doc.id).fragments[0],input={subject:'Newsletter',predicate:'Costo dichiarato',value:'80 EUR',context:'Periodo sintetico',references:[{documentId:x.doc.id,fragmentId:fragment.id}]},claim=claims.save(x.tenant.id,null,input,user),job=enqueue(x);
  const renderer=async(...args)=>{const pdf=await renderReport(...args);claims.save(x.tenant.id,claim.id,{...input,value:'Correzione da verificare',expectedVersion:1},user);return pdf;};
  await new IngestionWorker(x.db,x.config,{reportRenderer:renderer}).tick();assert.equal(x.service.getJob(x.tenant.id,job.id).errorCode,'report_inputs_changed');assert.equal(listReports(x.db,x.tenant.id).length,0);
 }finally{x.close();}
});
test('real PDF report is versioned, encrypted and source-linked; deletion propagates',async()=>{const x=await setup();try{const job=enqueue(x);await new IngestionWorker(x.db,x.config).tick();const result=x.service.getJob(x.tenant.id,job.id);assert.equal(result.status,'completed');assert.equal(result.output.aiExecuted,false);const report=downloadReport(x.db,x.config,x.tenant.id,result.output.reportId,user);assert.equal(report.bytes.subarray(0,5).toString(),'%PDF-');assert.equal(Buffer.from(x.db.prepare('SELECT pdf FROM generated_reports').get().pdf).subarray(0,5).toString()==='%PDF-',false);
 if(process.env.REPORT_PROOF_PATH){mkdirSync(join(process.env.REPORT_PROOF_PATH,'..'),{recursive:true});writeFileSync(process.env.REPORT_PROOF_PATH,report.bytes);}
 const second=enqueue(x);await new IngestionWorker(x.db,x.config).tick();assert.equal(x.service.getJob(x.tenant.id,second.id).output.version,2);assert.equal(listReports(x.db,x.tenant.id).length,2);const graph=sourceGraph(x.db,x.tenant.id,x.config);assert.equal(graph.nodes.filter(n=>n.type==='document_report').length,2);assert.equal(graph.edges.filter(e=>e.type==='includes_source').length,2);assert.throws(()=>downloadReport(x.db,x.config,'other',result.output.reportId,user));x.service.deleteDocument(x.tenant.id,x.doc.id,admin);assert.equal(listReports(x.db,x.tenant.id).length,0);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM report_sources').get().n,0);x.service.eraseTenant(x.tenant.id,admin);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM report_series').get().n,0);
 }finally{x.close();}});
test('revocation during real report rendering prevents publication',async()=>{const x=await setup();try{const job=enqueue(x);const renderer=async(...args)=>{const pdf=await renderReport(...args);x.service.revokeMembership(x.tenant.id,user.id,admin);return pdf;};await new IngestionWorker(x.db,x.config,{reportRenderer:renderer}).tick();assert.equal(x.service.getJob(x.tenant.id,job.id).status,'cancelled');assert.equal(listReports(x.db,x.tenant.id).length,0);}finally{x.close();}});
test('changed note while rendering rejects stale dossier instead of publishing it',async()=>{const x=await setup();try{const job=enqueue(x);const renderer=async(...args)=>{const pdf=await renderReport(...args);const notes=new NoteService(x.db,x.config),note=notes.list(x.tenant.id,user)[0];notes.save(x.tenant.id,note.id,{...note,text:'Una nuova verifica è necessaria.',expectedVersion:note.version},user);return pdf;};await new IngestionWorker(x.db,x.config,{reportRenderer:renderer}).tick();assert.equal(x.service.getJob(x.tenant.id,job.id).errorCode,'report_inputs_changed');assert.equal(listReports(x.db,x.tenant.id).length,0);}finally{x.close();}});

test('expired report lease resumes after database reopen and finished PDF survives another restart',async()=>{
 const x=await setup();let reopened;
 try{
  const job=enqueue(x);x.db.prepare("UPDATE jobs SET status='running',lease_owner='interrupted',lease_until=?,attempts=1 WHERE id=?").run(Date.now()-1,job.id);
  x.db.close();reopened=createPlatformApp(x.config);
  await new IngestionWorker(reopened.db,x.config).tick();const result=reopened.service.getJob(x.tenant.id,job.id);assert.equal(result.status,'completed');assert.equal(result.attempts,2);
  const id=result.output.reportId;reopened.db.close();reopened=createPlatformApp(x.config);
  assert.equal(downloadReport(reopened.db,x.config,x.tenant.id,id,user).bytes.subarray(0,5).toString(),'%PDF-');assert.equal(listReports(reopened.db,x.tenant.id).length,1);
 }finally{if(reopened)reopened.db.close();rmSync(x.dir,{recursive:true,force:true});}
});
