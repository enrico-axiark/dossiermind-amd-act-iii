import {sourceGraph} from "../src/retrieval.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPlatformApp} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {NoteService} from '../src/notes.mjs';
import {IngestionWorker} from '../src/ingestion.mjs';
const admin={id:'admin',type:'user',scopes:new Set(['platform:admin'])};
const who=id=>({id,type:'user',scopes:new Set(),claimedTenantIds:new Set()});
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'dm-notes-')),config=loadConfig({nodeEnv:'test',baseDir:dir,dbPath:'db.sqlite',storageRoot:join(dir,'objects'),allowInsecureDevAuth:true,masterKey:randomBytes(32),auditKey:randomBytes(32),pythonExecutable:process.env.PYTHON_EXECUTABLE||'python3'});
 const app=createPlatformApp(config),org=app.service.createOrganization({name:'Synthetic',type:'pmi'},admin),a=app.service.createTenant({organizationId:org.id,name:'A'},admin),b=app.service.createTenant({organizationId:org.id,name:'B'},admin);
 for(const id of ['owner','studio','other'])app.service.createUser({id,email:id+'@example.test',displayName:id},admin);
 for(const [tenant,user,role] of [[a,'owner','owner'],[a,'studio','accountant'],[b,'other','owner']])app.service.addMembership(tenant.id,{userId:user,role,scopes:['documents:read','documents:write','jobs:read','jobs:write']},admin);
 const doc=app.service.uploadDocument(a.id,{filename:'costs.csv',mimeType:'text/csv',bytes:Buffer.from('Servizio,Importo\nNewsletter,80\n')},who('owner'));
 app.service.createJob(a.id,{type:'ingestion',input:{documentIds:[doc.id]}},who('owner'));await new IngestionWorker(app.db,config).tick();
 const fragment=app.service.getFragments(a.id,doc.id).fragments[0];
 return {...app,config,dir,a,b,doc,notes:new NoteService(app.db,config),input:{title:'Revisione costi',text:'Verificare utilizzo e preavviso prima di decidere.',references:[{documentId:doc.id,fragmentId:fragment.id}]},close(){app.db.close();rmSync(dir,{recursive:true,force:true});}};
}
test('sourced contributions encrypted, attributed and versioned; stale edit conflicts instead of losing updates',async()=>{
 const x=await setup();try{
 const first=x.notes.save(x.a.id,null,x.input,who('owner'));assert.equal(first.version,1);assert.equal(first.origin,'human');const graph=sourceGraph(x.db,x.a.id,x.config);assert.equal(graph.nodes.filter(n=>n.type==='human_note').length,1);assert.equal(graph.edges.find(e=>e.type==='cites_source').documentId,x.doc.id);assert.equal(graph.knowledgeGraphReady,false);assert.equal(first.references[0].sourceHash,x.doc.sha256);assert.equal(first.references[0].locator.row,2);
 const stored=x.db.prepare('SELECT body FROM note_revisions').get().body;assert.equal(Buffer.from(stored).includes(Buffer.from(x.input.text)),false);
 const second=x.notes.save(x.a.id,first.id,{...x.input,text:'Contributo dello studio da verificare.',expectedVersion:1},who('studio'));assert.equal(second.version,2);assert.equal(second.authorName,'studio');
 assert.throws(()=>x.notes.save(x.a.id,first.id,{...x.input,expectedVersion:1},who('owner')),e=>e.code==='note_version_conflict');
 assert.equal(x.notes.list(x.a.id,who('owner'))[0].text,second.text);assert.deepEqual(x.notes.history(x.a.id,first.id,who('owner')).map(r=>r.authorId),['studio','owner']);assert.equal(x.service.audit(x.a.id).validChain,true);assert.equal(x.service.exportTenant(x.a.id,admin).payload.noteRevisions.length,2);
 }finally{x.close();}
});
test('notes reject invented and cross-client citations; revoke blocks reads/writes; deletion purges every linked revision',async()=>{
 const x=await setup();try{
 assert.throws(()=>x.notes.save(x.b.id,null,x.input,who('other')),e=>e.code==='invalid_note_sources');
 assert.throws(()=>x.notes.save(x.a.id,null,{...x.input,references:[{documentId:x.doc.id,fragmentId:'invented'}]},who('owner')),e=>e.code==='invalid_note_sources');
 const n=x.notes.save(x.a.id,null,x.input,who('studio'));assert.throws(()=>x.notes.history(x.b.id,n.id,who('other')));
 x.service.revokeMembership(x.a.id,'studio',admin);assert.throws(()=>x.notes.list(x.a.id,who('studio')));assert.throws(()=>x.notes.save(x.a.id,n.id,{...x.input,expectedVersion:1},who('studio')));
 assert.equal(x.service.exportTenant(x.a.id,admin).payload.notes.length,1);
 x.service.deleteDocument(x.a.id,x.doc.id,admin);assert.equal(x.notes.list(x.a.id,who('owner')).length,0);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM note_revisions').get().n,0);
 x.service.eraseTenant(x.a.id,admin);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM source_notes').get().n,0);
 }finally{x.close();}
});
test('HTTP notes enforce live permissions and do not expose another client revision',async()=>{
 const x=await setup();try{
 await new Promise(resolve=>x.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+x.server.address().port;
 const headers=id=>({authorization:'Bearer dev.'+Buffer.from(JSON.stringify({sub:id,scope:''})).toString('base64url'),'content-type':'application/json'});
 const path=base+'/v1/tenants/'+x.a.id+'/brain/notes';const res=await fetch(path,{method:'POST',headers:headers('owner'),body:JSON.stringify(x.input)});assert.equal(res.status,201);const n=await res.json();
 assert.equal((await fetch(path,{headers:headers('studio')})).status,200);
 assert.equal((await fetch(base+'/v1/tenants/'+x.b.id+'/brain/notes/'+n.id,{headers:headers('other')})).status,404);
 x.service.revokeMembership(x.a.id,'studio',admin);assert.equal((await fetch(path,{headers:headers('studio')})).status,403);
 }finally{if(x.server.listening)await new Promise(resolve=>x.server.close(resolve));x.close();}
});

test('shared-note search exposes only latest current tenant-bound contributions and honors live revocation',async()=>{
 const x=await setup();try{
  await new Promise(resolve=>x.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+x.server.address().port;
  const headers=id=>({authorization:'Bearer dev.'+Buffer.from(JSON.stringify({sub:id,scope:''})).toString('base64url')});
  const search=(tenant,q,id='owner')=>fetch(`${base}/v1/tenants/${tenant}/brain/search?q=${encodeURIComponent(q)}`,{headers:headers(id)});
  const n=x.notes.save(x.a.id,null,{...x.input,title:'Résumé operativo',text:'Unicoprimaversione: chiedere il preavviso.'},who('owner'));
  let response=await search(x.a.id,'resume');assert.equal(response.status,200);let body=await response.json();assert.equal(body.data.length,0);assert.equal(body.sharedNotes.length,1);assert.equal(body.sharedNotes[0].authorName,'owner');assert.equal(body.sharedNotes[0].references[0].documentId,x.doc.id);assert.equal(body.sharedNotes[0].independentEvidence,false);assert.equal(body.sharedNotes[0].truthVerified,false);assert.equal(body.sharedNotes[0].support,'author-contribution-not-verified-fact');
  x.notes.save(x.a.id,n.id,{...x.input,title:'Résumé operativo',text:'Unicosecondaversione: penale ancora sconosciuta.',expectedVersion:1},who('studio'));
  assert.equal((await(await search(x.a.id,'Unicoprimaversione')).json()).sharedNotes.length,0);
  body=await(await search(x.a.id,'Unicosecondaversione','studio')).json();assert.equal(body.sharedNotes[0].version,2);assert.equal(body.sharedNotes[0].authorName,'studio');
  assert.equal((await search(x.a.id,'Unicosecondaversione','other')).status,403);
  assert.equal((await(await search(x.b.id,'Unicosecondaversione','other')).json()).sharedNotes.length,0);
  x.service.revokeMembership(x.a.id,'studio',admin);assert.equal((await search(x.a.id,'Unicosecondaversione','studio')).status,403);
  x.db.prepare('DELETE FROM document_extractions WHERE document_id=?').run(x.doc.id);
  assert.equal((await(await search(x.a.id,'Unicosecondaversione')).json()).sharedNotes.length,0);
 }finally{if(x.server.listening)await new Promise(resolve=>x.server.close(resolve));x.close();}
});
