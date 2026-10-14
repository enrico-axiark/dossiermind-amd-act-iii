import {spawnSync} from 'node:child_process';
import {sourceGraph} from '../src/retrieval.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPlatformApp} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {ChecklistService} from '../src/checklists.mjs';
import {IngestionWorker} from '../src/ingestion.mjs';
import {renderReport,listReports,reportSnapshot,downloadReport,migrateReports} from '../src/reports.mjs';
const admin={id:'admin',type:'user',scopes:new Set(['platform:admin'])};
const who=id=>({id,type:'user',scopes:new Set(),claimedTenantIds:new Set()});
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'dm-checklist-')),config=loadConfig({nodeEnv:'test',baseDir:dir,dbPath:'db.sqlite',storageRoot:join(dir,'objects'),allowInsecureDevAuth:true,masterKey:randomBytes(32),auditKey:randomBytes(32),pythonExecutable:process.env.PYTHON_EXECUTABLE||'python3'}),app=createPlatformApp(config);
 const org=app.service.createOrganization({name:'Synthetic',type:'pmi'},admin),a=app.service.createTenant({organizationId:org.id,name:'A'},admin),b=app.service.createTenant({organizationId:org.id,name:'B'},admin);
 for(const id of ['owner','studio','reader','other'])app.service.createUser({id,email:id+'@example.test',displayName:id},admin);
 for(const [t,id,scopes] of [[a,'owner',['documents:read','documents:write','jobs:write']],[a,'studio',['documents:read','documents:write']],[a,'reader',['documents:read']],[b,'other',['documents:read','documents:write']]])app.service.addMembership(t.id,{userId:id,role:id==='studio'?'accountant':'owner',scopes},admin);
 const doc=app.service.uploadDocument(a.id,{filename:'costs.csv',mimeType:'text/csv',bytes:Buffer.from('Servizio,Importo\nNewsletter,80\n')},who('owner'));
 app.service.createJob(a.id,{type:'ingestion',input:{documentIds:[doc.id]}},admin);await new IngestionWorker(app.db,config).tick();
 const fragment=app.service.getFragments(a.id,doc.id).fragments[0],input={title:'Requisiti concordati',periodStart:'2026-09-01',periodEnd:'2026-09-30',items:[{id:'invoice',requirement:'Fattura del servizio',status:'missing',references:[]}]};
 return {...app,dir,config,a,b,doc,input,ref:{documentId:doc.id,fragmentId:fragment.id},checklists:new ChecklistService(app.db,config),close(){app.db.close();rmSync(dir,{recursive:true,force:true});}};
}
test('explicit requirements stay missing despite upload; evidence and review are separate, encrypted, attributed, versioned',async()=>{const x=await setup();try{
 const first=x.checklists.save(x.a.id,null,x.input,who('owner'));assert.equal(first.counts.missing,1);assert.equal(first.independentEvidence,false);
 assert.equal(Buffer.from(x.db.prepare('SELECT body FROM checklist_revisions').get().body).includes(Buffer.from(x.input.title)),false);
 const received={...x.input,expectedVersion:1,items:[{...first.items[0],status:'received',references:[x.ref]}]};const second=x.checklists.save(x.a.id,first.id,received,who('studio'));assert.equal(second.counts.received,1);assert.equal(second.items[0].references[0].locator.row,2);const graph=sourceGraph(x.db,x.a.id,x.config);assert.equal(graph.nodes.filter(node=>node.type==='explicit_checklist').length,1);assert.equal(graph.edges.find(edge=>edge.type==='requirement_evidence').fragmentId,x.ref.fragmentId);assert.equal(graph.knowledgeGraphReady,false);
 const review={...received,expectedVersion:2,items:[{...second.items[0],status:'reviewed'}]};assert.throws(()=>x.checklists.save(x.a.id,first.id,review,who('studio')),e=>e.code==='checklist_review_confirmation_required');
 const third=x.checklists.save(x.a.id,first.id,{...review,confirmHumanReview:true},who('studio'));assert.equal(third.items[0].reviewedBy,'studio');assert.equal(third.items[0].reviewerName,'studio');
 const fourth=x.checklists.save(x.a.id,first.id,{...third,title:'Titolo aggiornato',expectedVersion:3},who('owner'));assert.equal(fourth.items[0].reviewedBy,'studio');assert.equal(fourth.items[0].reviewedAt,third.items[0].reviewedAt);
 assert.throws(()=>x.checklists.save(x.a.id,first.id,{...third,expectedVersion:3},who('owner')),e=>e.code==='checklist_version_conflict');
 assert.throws(()=>x.checklists.save(x.a.id,first.id,{...fourth,periodEnd:'2026-10-01',expectedVersion:4},who('owner')),e=>e.code==='checklist_review_confirmation_required');
 assert.equal(x.checklists.history(x.a.id,first.id,who('owner')).length,4);assert.equal(x.service.exportTenant(x.a.id,admin).payload.checklistRevisions.length,4);
 }finally{x.close();}});
test('reject fabricated/cross-client sources and invalid periods; revocation and deletion propagate every historical reference',async()=>{const x=await setup();try{
 for(const periodEnd of ['2026-02-30','2026-08-01'])assert.throws(()=>x.checklists.save(x.a.id,null,{...x.input,periodEnd},who('owner')),e=>e.code==='invalid_checklist');
 const sourced={...x.input,items:[{...x.input.items[0],status:'received',references:[x.ref]}]};
 assert.throws(()=>x.checklists.save(x.b.id,null,sourced,who('other')),e=>e.code==='invalid_checklist_sources');
 assert.throws(()=>x.checklists.save(x.a.id,null,{...sourced,items:[{...sourced.items[0],references:[{...x.ref,fragmentId:'invented'}]}]},who('owner')),e=>e.code==='invalid_checklist_sources');
 const saved=x.checklists.save(x.a.id,null,sourced,who('studio'));x.checklists.save(x.a.id,saved.id,{...x.input,expectedVersion:1},who('owner'));
 assert.throws(()=>x.checklists.history(x.b.id,saved.id,who('other')),e=>e.code==='checklist_not_found');
 x.service.revokeMembership(x.a.id,'studio',admin);assert.throws(()=>x.checklists.list(x.a.id,who('studio')));
 x.service.deleteDocument(x.a.id,x.doc.id,admin);assert.equal(x.checklists.list(x.a.id,who('owner')).length,0);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM checklist_revisions').get().n,0);
 x.checklists.save(x.a.id,null,x.input,who('owner'));x.service.eraseTenant(x.a.id,admin);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM dossier_checklists').get().n,0);
 }finally{x.close();}});
test('source change downgrades reviewed evidence and checklist edits invalidate an in-flight real PDF',async()=>{const x=await setup();try{
 const saved=x.checklists.save(x.a.id,null,{...x.input,confirmHumanReview:true,items:[{...x.input.items[0],status:'reviewed',references:[x.ref]}]},who('owner'));
 const snapshot=reportSnapshot(x.db,x.config,x.a.id);assert.equal(snapshot.snapshot.checklists[0].counts.reviewed,1);
 const parser=x.db.prepare('SELECT parser_version FROM document_extractions WHERE document_id=?').get(x.doc.id).parser_version;x.db.prepare('UPDATE document_extractions SET parser_version=? WHERE document_id=?').run('changed-version',x.doc.id);assert.equal(x.checklists.list(x.a.id,who('owner'))[0].items[0].status,'needs_review');x.db.prepare('UPDATE document_extractions SET parser_version=? WHERE document_id=?').run(parser,x.doc.id);
 x.db.prepare('UPDATE documents SET sha256=? WHERE id=?').run('changed',x.doc.id);assert.equal(x.checklists.list(x.a.id,who('owner'))[0].items[0].status,'needs_review');x.db.prepare('UPDATE documents SET sha256=? WHERE id=?').run(x.doc.sha256,x.doc.id);
 const job=x.service.createJob(x.a.id,{type:'report',input:{kind:'document_dossier'}},who('owner'));
 const renderer=async(...args)=>{const bytes=await renderReport(...args);x.checklists.save(x.a.id,saved.id,{...x.input,title:'Cambiato durante il rendering',expectedVersion:1},who('owner'));return bytes;};
 await new IngestionWorker(x.db,x.config,{reportRenderer:renderer}).tick();assert.equal(x.service.getJob(x.a.id,job.id).errorCode,'report_inputs_changed');assert.equal(listReports(x.db,x.a.id).length,0);
 }finally{x.close();}});
test('HTTP checklist endpoints reject read-only writes, stale revisions and revoked sessions',async()=>{const x=await setup();try{
 await new Promise(resolve=>x.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+x.server.address().port+'/v1/tenants/'+x.a.id+'/brain/checklists';
 const headers=id=>({authorization:'Bearer dev.'+Buffer.from(JSON.stringify({sub:id,scope:''})).toString('base64url'),'content-type':'application/json'});
 assert.equal((await fetch(url,{method:'POST',headers:headers('reader'),body:JSON.stringify(x.input)})).status,403);
 const res=await fetch(url,{method:'POST',headers:headers('owner'),body:JSON.stringify(x.input)});assert.equal(res.status,201);const item=await res.json();
 assert.equal((await fetch(url+'/'+item.id,{method:'PUT',headers:headers('owner'),body:JSON.stringify({...x.input,expectedVersion:0})})).status,409);
 assert.equal((await fetch(url+'/'+item.id,{headers:headers('studio')})).status,200);x.service.revokeMembership(x.a.id,'studio',admin);assert.equal((await fetch(url,{headers:headers('studio')})).status,403);
 }finally{if(x.server.listening)await new Promise(resolve=>x.server.close(resolve));x.close();}});

test('PMI and private missing reports use only the selected explicit checklist, support an empty archive and require live scoped selection',async()=>{const x=await setup();try{
 const chosen=x.checklists.save(x.a.id,null,x.input,who('owner'));
 x.checklists.save(x.a.id,null,{...x.input,title:'Other checklist',items:[{...x.input.items[0],requirement:'Unrelated request'}]},who('owner'));
 for(const kind of ['pmi_missing_documents','private_missing_documents']){
  assert.throws(()=>x.service.createJob(x.a.id,{type:'report',input:{kind}},who('owner')),e=>e.code==='report_checklist_required');
  assert.throws(()=>x.service.createJob(x.a.id,{type:'report',input:{kind,checklistId:'another-client'}},who('owner')),e=>e.code==='report_checklist_required');
  const snapshot=reportSnapshot(x.db,x.config,x.a.id,{kind,checklistId:chosen.id});assert.equal(snapshot.snapshot.checklists.length,1);assert.equal(snapshot.snapshot.documents.length,0);assert.equal(snapshot.snapshot.notes.length,0);
  const job=x.service.createJob(x.a.id,{type:'report',input:{kind,checklistId:chosen.id}},who('owner'));await new IngestionWorker(x.db,x.config).tick();const result=x.service.getJob(x.a.id,job.id);assert.equal(result.status,'completed');assert.equal(result.output.stage,kind);assert.equal(result.output.aiExecuted,false);
  const report=downloadReport(x.db,x.config,x.a.id,result.output.reportId,who('owner'));assert.match(report.filename,/missing-documents/);assert.equal(report.bytes.subarray(0,5).toString(),'%PDF-');if(process.env.CHECKLIST_REPORT_PROOF_PATH)writeFileSync(process.env.CHECKLIST_REPORT_PROOF_PATH,report.bytes);
 }
 assert.deepEqual(listReports(x.db,x.a.id).map(report=>report.kind),['private_missing_documents','pmi_missing_documents']);
 x.service.deleteDocument(x.a.id,x.doc.id,admin);
 const job=x.service.createJob(x.a.id,{type:'report',input:{kind:'pmi_missing_documents',checklistId:chosen.id}},who('owner'));await new IngestionWorker(x.db,x.config).tick();assert.equal(x.service.getJob(x.a.id,job.id).status,'completed');
 }finally{x.close();}});

test('studio and professional briefs include attributable contributions and declared checklist period without calling a model',async()=>{const x=await setup();try{
 const chosen=x.checklists.save(x.a.id,null,x.input,who('owner'));
 for(const kind of ['pmi_studio_brief','private_professional_brief']){
  const snapshot=reportSnapshot(x.db,x.config,x.a.id,{kind,checklistId:chosen.id});assert.equal(snapshot.snapshot.documents.length,1);assert.equal(snapshot.snapshot.checklists[0].periodStart,'2026-09-01');
  const job=x.service.createJob(x.a.id,{type:'report',input:{kind,checklistId:chosen.id}},who('owner'));await new IngestionWorker(x.db,x.config).tick();const result=x.service.getJob(x.a.id,job.id);assert.equal(result.status,'completed');assert.equal(result.output.stage,kind);assert.equal(result.output.aiExecuted,false);
  const report=downloadReport(x.db,x.config,x.a.id,result.output.reportId,who('owner'));assert.equal(report.bytes.subarray(0,5).toString(),'%PDF-');if(process.env.BRIEF_REPORT_PROOF_PATH)writeFileSync(process.env.BRIEF_REPORT_PROOF_PATH,report.bytes);
 }
 }finally{x.close();}});

test('deleting a historically linked original also erases reports based on the checklist after its current evidence was unlinked',async()=>{const x=await setup();try{
 const chosen=x.checklists.save(x.a.id,null,{...x.input,items:[{...x.input.items[0],status:'received',references:[x.ref]}]},who('owner'));
 x.checklists.save(x.a.id,chosen.id,{...x.input,expectedVersion:1},who('owner'));
 const job=x.service.createJob(x.a.id,{type:'report',input:{kind:'pmi_missing_documents',checklistId:chosen.id}},who('owner'));await new IngestionWorker(x.db,x.config).tick();const result=x.service.getJob(x.a.id,job.id);assert.equal(result.status,'completed');assert.equal(result.output.sourceCount,0);assert.equal(listReports(x.db,x.a.id).length,1);
 x.service.deleteDocument(x.a.id,x.doc.id,admin);assert.equal(listReports(x.db,x.a.id).length,0);assert.equal(x.checklists.list(x.a.id,who('owner')).length,0);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM report_checklists').get().n,0);
 }finally{x.close();}});

test('upgrade reconstructs only exact completed-job checklist dependencies and preserves unrelated historical PDFs',async()=>{const x=await setup();try{
 const linked=x.checklists.save(x.a.id,null,{...x.input,items:[{...x.input.items[0],status:'received',references:[x.ref]}]},who('owner'));x.checklists.save(x.a.id,linked.id,{...x.input,expectedVersion:1},who('owner'));
 const unrelated=x.checklists.save(x.a.id,null,{...x.input,title:'Unrelated checklist'},who('owner')),reports=[];
 for(const chosen of [linked,unrelated]){const job=x.service.createJob(x.a.id,{type:'report',input:{kind:'pmi_missing_documents',checklistId:chosen.id}},who('owner'));await new IngestionWorker(x.db,x.config).tick();reports.push(x.service.getJob(x.a.id,job.id).output.reportId);}
 x.db.exec('DROP TABLE report_checklists');migrateReports(x.db);
 assert.equal(x.db.prepare('SELECT COUNT(*) n FROM report_checklists').get().n,2);
 assert.equal(x.db.prepare('SELECT checklist_id FROM report_checklists WHERE report_id=?').get(reports[0]).checklist_id,linked.id);
 assert.equal(x.db.prepare('SELECT checklist_id FROM report_checklists WHERE report_id=?').get(reports[1]).checklist_id,unrelated.id);
 x.service.deleteDocument(x.a.id,x.doc.id,admin);assert.deepEqual(listReports(x.db,x.a.id).map(report=>report.id),[reports[1]]);
 }finally{x.close();}});


test('missing-document PDF names the exact source location and keeps received distinct from reviewed',async()=>{const x=await setup();try{
 const chosen=x.checklists.save(x.a.id,null,{...x.input,items:[{...x.input.items[0],status:'received',references:[x.ref]}]},who('owner'));
 const job=x.service.createJob(x.a.id,{type:'report',input:{kind:'private_missing_documents',checklistId:chosen.id}},who('owner'));await new IngestionWorker(x.db,x.config).tick();const result=x.service.getJob(x.a.id,job.id);assert.equal(result.status,'completed');
 const bytes=downloadReport(x.db,x.config,x.a.id,result.output.reportId,who('owner')).bytes;
 const parsed=spawnSync(x.config.pythonExecutable,['-c','import sys,io;from pypdf import PdfReader;print("\\n".join(p.extract_text() for p in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages))'],{input:bytes,encoding:'utf8'});assert.equal(parsed.status,0,parsed.stderr);assert.match(parsed.stdout,/Fonte: costs.csv \| Riga 2/);assert.match(parsed.stdout,/Ricevuto, da verificare/);assert.match(parsed.stdout,/Verificati da utenti: 0/);assert.equal(parsed.stdout.includes('Riferimento 2'),false);
 if(process.env.CHECKLIST_LOCATION_PROOF_PATH)writeFileSync(process.env.CHECKLIST_LOCATION_PROOF_PATH,bytes);
 }finally{x.close();}});
