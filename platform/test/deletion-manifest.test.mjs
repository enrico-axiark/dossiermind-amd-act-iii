import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createPlatformApp} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {IngestionWorker} from '../src/ingestion.mjs';
import {NoteService} from '../src/notes.mjs';
import {ChecklistService} from '../src/checklists.mjs';
import {AssertionService} from '../src/assertions.mjs';
import {DocumentMemory} from '../src/document-memory.mjs';
import {AdvisorJobs} from '../src/advisor-jobs.mjs';
import {sourceGraph,searchFragments} from '../src/retrieval.mjs';
const admin={id:'admin',type:'user',scopes:new Set(['platform:admin'])},owner={id:'owner',type:'user',scopes:new Set()};
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'dm-delete-')),config=loadConfig({nodeEnv:'test',baseDir:dir,dbPath:'db.sqlite',storageRoot:join(dir,'objects'),allowInsecureDevAuth:true,masterKey:randomBytes(32),auditKey:randomBytes(32),pythonExecutable:process.env.PYTHON_EXECUTABLE||'python3'}),app=createPlatformApp(config),org=app.service.createOrganization({name:'Synthetic',type:'pmi'},admin),tenant=app.service.createTenant({organizationId:org.id,name:'Synthetic'},admin);
 app.service.createUser({id:'owner',email:'owner@example.test',displayName:'Synthetic owner'},admin);app.service.createUser({id:'reader',email:'reader@example.test',displayName:'Synthetic reader'},admin);
 app.service.addMembership(tenant.id,{userId:'owner',role:'owner',scopes:['documents:read','documents:write','documents:delete','jobs:read','jobs:write']},admin);app.service.addMembership(tenant.id,{userId:'reader',role:'accountant',scopes:['documents:read']},admin);
 const doc=app.service.uploadDocument(tenant.id,{filename:'source.csv',mimeType:'text/csv',bytes:Buffer.from('Service,Amount\nCloud,120.00\n')},owner);app.service.createJob(tenant.id,{type:'ingestion',input:{documentIds:[doc.id]}},owner);await new IngestionWorker(app.db,config).tick();
 return {...app,dir,config,tenant,doc,ref:{documentId:doc.id,fragmentId:app.service.getFragments(tenant.id,doc.id).fragments[0].id},close(){app.db.close();rmSync(dir,{recursive:true,force:true});}};
}
// Explicit synthetic transports qualify deletion plumbing only, never live AI.
const gateway={readiness:()=>({enabled:true}),complete:async input=>{const p=JSON.parse(input.messages[1].content).passages[0];return {output:input.name==='document_memory'?{status:'proposed',title:'Cloud proposal',classification:'other',facts:[{text:'Synthetic proposed fact',evidence:{passageId:p.passageId,quote:p.text}}],entities:[],relations:[]}:{status:'answer',facts:[{evidenceId:p.evidenceId,quote:p.text}],interpretations:[],recommendations:[],scenarios:[],missingInformation:[]},metadata:{fixture:true}};}};
test('deletion manifest includes historical multi-source contributions and real PDF, blocks changed scope and purges only linked data',async()=>{
 const x=await setup();try{
  const notes=new NoteService(x.db,x.config),n=notes.save(x.tenant.id,null,{title:'Linked note',text:'Historical source text',references:[x.ref]},owner);
  const another=x.service.uploadDocument(x.tenant.id,{filename:'kept.csv',mimeType:'text/csv',bytes:Buffer.from('Service,Amount\nKept,50.00\n')},owner);x.service.createJob(x.tenant.id,{type:'ingestion',input:{documentIds:[another.id]}},owner);await new IngestionWorker(x.db,x.config).tick();
  const keptRef={documentId:another.id,fragmentId:x.service.getFragments(x.tenant.id,another.id).fragments[0].id};
  notes.save(x.tenant.id,n.id,{title:'Now uses another source',text:'Revision text',expectedVersion:1,references:[keptRef]},owner);const kept=notes.save(x.tenant.id,null,{title:'Unrelated note',text:'Keep this note',references:[keptRef]},owner);
  const checklist=new ChecklistService(x.db,x.config).save(x.tenant.id,null,{title:'Checklist',periodStart:'2026-09-01',periodEnd:'2026-09-30',items:[{id:'cost',requirement:'Cost document',status:'received',references:[x.ref]}]},owner);
  new AssertionService(x.db,x.config).save(x.tenant.id,null,{subject:'Cloud',predicate:'Cost',value:'120 EUR',context:'Synthetic',references:[x.ref]},owner);
  const memory=new DocumentMemory(x.db,x.config,gateway),m=memory.create(x.tenant.id,{documentId:x.doc.id},owner);await memory.tick();memory.review(x.tenant.id,m.id,{status:'approved',comment:'Synthetic test review',expectedVersion:0,confirmHumanReview:true},owner);
  const advisor=new AdvisorJobs(x.db,x.config,gateway),job=advisor.create(x.tenant.id,{question:'Cloud'},owner);await advisor.tick();advisor.review(x.tenant.id,job.id,{status:'approved',comment:'Synthetic answer review',expectedVersion:0,confirmHumanReview:true},owner);
  const report=x.service.createJob(x.tenant.id,{type:'report',input:{kind:'pmi_missing_documents',checklistId:checklist.id}},owner);await new IngestionWorker(x.db,x.config).tick();assert.equal(x.service.getJob(x.tenant.id,report.id).status,'completed');
  let manifest=x.service.deletionManifest(x.tenant.id,x.doc.id);assert.equal(manifest.affected.noteRevisions,2);assert.deepEqual(manifest.affected.notes,[n.id]);assert.equal(manifest.affected.memoryReviews,1);assert.equal(manifest.affected.advisorReviews,1);assert.equal(manifest.affected.reports.length,1);assert.equal(JSON.stringify(manifest).includes('Historical source text'),false);
  notes.save(x.tenant.id,null,{title:'New dependency',text:'New note',references:[x.ref]},owner);assert.throws(()=>x.service.deleteDocument(x.tenant.id,x.doc.id,admin,manifest.manifestSha256),e=>e.code==='deletion_manifest_changed');
  manifest=x.service.deletionManifest(x.tenant.id,x.doc.id);const path=x.db.prepare('SELECT stored_path FROM documents WHERE id=?').get(x.doc.id).stored_path;const result=x.service.deleteDocument(x.tenant.id,x.doc.id,admin,manifest.manifestSha256);assert.equal(result.manifestSha256,manifest.manifestSha256);assert.equal(existsSync(join(x.config.storageRoot,path)),false);
  assert.equal(memory.export(x.tenant.id).length,0);assert.equal(advisor.export(x.tenant.id).length,0);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM generated_reports').get().n,0);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM memory_reviews').get().n,0);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM advisor_reviews').get().n,0);assert.equal(new ChecklistService(x.db,x.config).current(x.tenant.id).length,0);assert.equal(new AssertionService(x.db,x.config).current(x.tenant.id).length,0);assert.deepEqual(notes.list(x.tenant.id,owner).map(n=>n.id),[kept.id]);assert.equal(searchFragments(x.db,x.config,x.tenant.id,'Cloud').totalMatches,0);assert.equal(sourceGraph(x.db,x.tenant.id,x.config).nodes.some(n=>n.id===x.doc.id),false);assert.equal(x.service.audit(x.tenant.id).validChain,true);
 }finally{x.close();}
});
test('HTTP deletion requires current manifest and delete permission; legal hold blocks preview and commit without changes',async()=>{
 const x=await setup();await new Promise(r=>x.server.listen(0,'127.0.0.1',r));try{
  const url=`http://127.0.0.1:${x.server.address().port}/v1/tenants/${x.tenant.id}/documents/${x.doc.id}`,headers=id=>({authorization:'Bearer dev.'+Buffer.from(JSON.stringify({sub:id,scope:''})).toString('base64url')});
  assert.equal((await fetch(url+'/deletion-manifest',{headers:headers('reader')})).status,403);
  assert.equal((await fetch(url,{method:'DELETE',headers:headers('owner')})).status,400);
  const before=await (await fetch(url+'/deletion-manifest',{headers:headers('owner')})).json();x.service.addLegalHold(x.tenant.id,{reason:'Synthetic preservation test'},admin);
  const held=await (await fetch(url+'/deletion-manifest',{headers:headers('owner')})).json();assert.equal(held.blocked,true);assert.equal(held.activeHoldCount,1);
  assert.equal((await fetch(url,{method:'DELETE',headers:{...headers('owner'),'x-deletion-manifest':before.manifestSha256}})).status,409);assert.equal(x.service.listDocuments(x.tenant.id).length,1);
  x.db.prepare('UPDATE legal_holds SET active=0 WHERE tenant_id=?').run(x.tenant.id);const current=await (await fetch(url+'/deletion-manifest',{headers:headers('owner')})).json();assert.equal((await fetch(url,{method:'DELETE',headers:{...headers('owner'),'x-deletion-manifest':current.manifestSha256}})).status,200);assert.equal((await fetch(url+'/deletion-manifest',{headers:headers('owner')})).status,404);
 }finally{await new Promise(r=>x.server.close(r));x.close();}
});

test('startup finishes already-started partial deletion; hold or unsafe object path retains hidden pending state for repair',async()=>{
 for(const scenario of ['original_missing','hold','unsafe_path']){
  const x=await setup();let reopened;try{
   new NoteService(x.db,x.config).save(x.tenant.id,null,{title:'Linked',text:'Synthetic content',references:[x.ref]},owner);
   const original=x.db.prepare('SELECT stored_path FROM documents WHERE id=?').get(x.doc.id).stored_path;
   x.db.prepare("UPDATE documents SET status='deleting' WHERE id=?").run(x.doc.id);
   if(scenario==='original_missing')unlinkSync(join(x.config.storageRoot,original));
   if(scenario==='hold')x.service.addLegalHold(x.tenant.id,{reason:'Synthetic hold after interruption'},admin);
   if(scenario==='unsafe_path')x.db.prepare("UPDATE documents SET stored_path='../outside' WHERE id=?").run(x.doc.id);
   x.db.close();reopened=createPlatformApp(x.config);
   assert.equal(reopened.service.listDocuments(x.tenant.id).length,0);assert.equal(reopened.deletionRecovery.pending,1);
   const state=reopened.db.prepare('SELECT status FROM documents WHERE id=?').get(x.doc.id).status;
   if(scenario==='original_missing'){assert.equal(state,'deleted');assert.equal(reopened.deletionRecovery.completed,1);assert.equal(reopened.db.prepare('SELECT COUNT(*) n FROM source_notes').get().n,0);assert.equal(reopened.db.prepare('SELECT COUNT(*) n FROM document_extractions').get().n,0);}
   else{assert.equal(state,'deleting');assert.equal(reopened.deletionRecovery.completed,0);assert.equal(reopened.deletionRecovery[scenario==='hold'?'blockedByHold':'failed'],1);
    if(scenario==='hold')reopened.db.prepare('UPDATE legal_holds SET active=0 WHERE tenant_id=?').run(x.tenant.id);else reopened.db.prepare('UPDATE documents SET stored_path=? WHERE id=?').run(original,x.doc.id);
    assert.equal(reopened.service.resumeDocumentDeletions().completed,1);
   }
   assert.equal(reopened.service.resumeDocumentDeletions().pending,0);assert.equal(reopened.service.audit(x.tenant.id).validChain,true);
  }finally{if(reopened)reopened.db.close();else{try{x.db.close();}catch{}}rmSync(x.dir,{recursive:true,force:true});}
 }
});
