import {sourceGraph,searchFragments} from "../src/retrieval.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPlatformApp} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {AssertionService} from '../src/assertions.mjs';
import {assertionIssues,schemaIssues} from '../src/contracts.mjs';
import {readFileSync} from 'node:fs';
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
 return {...app,config,dir,a,b,doc,claims:new AssertionService(app.db,config),input:{subject:'Newsletter',predicate:'canone dichiarato',value:'80 EUR',context:'contratto corrente',references:[{documentId:doc.id,fragmentId:fragment.id}]},close(){app.db.close();rmSync(dir,{recursive:true,force:true});}};
}
test('human assertions preserve v1 schema and use nullable unmeasured confidence in explicit v1.1',async()=>{
 const x=await setup();try{
 const a=x.claims.save(x.a.id,null,x.input,who('owner'));assert.equal(a.assertion.confidence,null);assert.equal(a.assertion.confidence_basis,'not_measured');assert.equal(a.assertion.status,'proposed');assert.equal(a.assertion.origin.kind,'human');assert.equal(a.independentEvidence,false);assert.deepEqual(assertionIssues(a.assertion),[]);
 const legacy=JSON.parse(readFileSync(new URL('../brain/schemas/knowledge-assertion.schema.json',import.meta.url)));assert.equal(legacy.properties.confidence.type,'number');assert.ok(schemaIssues(a.assertion,legacy).length);
 assert.ok(assertionIssues({...a.assertion,confidence:1}).length);assert.ok(assertionIssues({...a.assertion,confidence_basis:'evaluated',confidence:null}).length);
 const stored=x.db.prepare('SELECT body FROM assertion_revisions').get().body;assert.equal(Buffer.from(stored).includes(Buffer.from(x.input.value)),false);
 assert.throws(()=>x.claims.save(x.a.id,null,{...x.input,confidence:1},who('owner')),e=>e.code==='invalid_assertion');
 }finally{x.close();}
});
test('review attributed on each revision; edits do not silently retain approval or overwrite another revision',async()=>{
 const x=await setup();try{
 const first=x.claims.save(x.a.id,null,x.input,who('owner'));
 assert.throws(()=>x.claims.save(x.a.id,first.id,{...x.input,expectedVersion:1,status:'verified'},who('studio')),e=>e.code==='assertion_review_confirmation_required');
 const approved=x.claims.save(x.a.id,first.id,{...x.input,expectedVersion:1,status:'verified',confirmHumanReview:true},who('studio'));assert.equal(approved.review.by,'studio');assert.equal(approved.assertion.confidence,null);
 assert.throws(()=>x.claims.save(x.a.id,first.id,{...x.input,expectedVersion:1},who('owner')),e=>e.code==='assertion_version_conflict');
 const revised=x.claims.save(x.a.id,first.id,{...x.input,value:'81 EUR',expectedVersion:2},who('owner'));assert.equal(revised.assertion.status,'proposed');assert.equal(revised.review,null);assert.equal(x.claims.history(x.a.id,first.id,who('owner')).length,3);assert.equal(x.service.audit(x.a.id).validChain,true);
 }finally{x.close();}
});
test('possible conflicts require exact context and never turn claims into semantic evidence',async()=>{
 const x=await setup();try{
 const one=x.claims.save(x.a.id,null,x.input,who('owner')),two=x.claims.save(x.a.id,null,{...x.input,value:'90 EUR'},who('studio'));
 const current=x.claims.list(x.a.id,who('owner'));assert.equal(current.find(a=>a.id===one.id).effectiveStatus,'conflicted');assert.deepEqual(current.find(a=>a.id===two.id).possibleConflicts,[one.id]);assert.equal(current[0].assertion.status,'proposed');const graph=sourceGraph(x.db,x.a.id,x.config);assert.equal(graph.nodes.filter(n=>n.type==='human_assertion').length,2);assert.equal(graph.edges.filter(e=>e.type==='possible_value_difference').length,1);assert.equal(graph.knowledgeGraphReady,false);
 const other=x.claims.save(x.a.id,null,{...x.input,value:'110 EUR',context:'contratto precedente'},who('owner'));assert.equal(other.effectiveStatus,'proposed');
 x.claims.save(x.a.id,two.id,{...x.input,value:'90 EUR',expectedVersion:1,status:'rejected',confirmHumanReview:true},who('studio'));assert.equal(x.claims.current(x.a.id).find(a=>a.id===one.id).possibleConflicts.length,0);
 x.db.prepare("UPDATE document_extractions SET parser_version='changed' WHERE document_id=?").run(x.doc.id);assert.equal(x.claims.current(x.a.id)[0].sourceState,'stale');assert.equal(x.claims.current(x.a.id)[0].effectiveStatus,'needs_review');
 }finally{x.close();}
});
test('cross-tenant sources, fake reviewer membership and revocation denied; export and source purge include full history',async()=>{
 const x=await setup();try{
 assert.throws(()=>x.claims.save(x.b.id,null,x.input,who('other')),e=>e.code==='invalid_assertion_sources');
 assert.throws(()=>x.claims.save(x.a.id,null,{...x.input,references:[{documentId:x.doc.id,fragmentId:'invented'}]},who('owner')),e=>e.code==='invalid_assertion_sources');
 assert.throws(()=>x.claims.save(x.a.id,null,x.input,admin),e=>e.code==='human_membership_required');
 const a=x.claims.save(x.a.id,null,x.input,who('studio'));x.claims.save(x.a.id,a.id,{...x.input,expectedVersion:1},who('owner'));
 assert.equal(x.service.exportTenant(x.a.id,admin).payload.assertionRevisions.length,2);
 x.service.revokeMembership(x.a.id,'studio',admin);assert.throws(()=>x.claims.list(x.a.id,who('studio')));assert.throws(()=>x.claims.history(x.b.id,a.id,who('other')),e=>e.code==='assertion_not_found');
 x.service.deleteDocument(x.a.id,x.doc.id,admin);assert.equal(x.claims.current(x.a.id).length,0);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM assertion_revisions').get().n,0);assert.equal(sourceGraph(x.db,x.a.id,x.config).nodes.filter(n=>n.type==='human_assertion').length,0);
 x.service.eraseTenant(x.a.id,admin);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM knowledge_assertions').get().n,0);
 }finally{x.close();}
});
test('search keeps human statements separate from original evidence, including conflict signals and excluding stale or rejected statements',async()=>{
 const x=await setup();try{
  const first=x.claims.save(x.a.id,null,x.input,who('owner')),second=x.claims.save(x.a.id,null,{...x.input,value:'90 EUR'},who('studio'));
  let result=searchFragments(x.db,x.config,x.a.id,'Newsletter');assert.equal(result.humanContributions.length,2);assert.ok(result.data.length>0);assert.equal(result.totalMatches,result.data.length);assert.ok(result.humanContributions.every(item=>item.origin==='human'&&item.independentEvidence===false&&item.status==='conflicted'));assert.equal(searchFragments(x.db,x.config,x.b.id,'Newsletter').humanContributions.length,0);
  x.claims.save(x.a.id,second.id,{...x.input,value:'90 EUR',expectedVersion:1,status:'rejected',confirmHumanReview:true},who('studio'));result=searchFragments(x.db,x.config,x.a.id,'Newsletter');assert.equal(result.humanContributions.length,1);assert.equal(result.humanContributions[0].id,first.id);assert.equal(result.humanContributions[0].status,'proposed');
  x.db.prepare("UPDATE document_extractions SET parser_version='changed' WHERE document_id=?").run(x.doc.id);assert.equal(searchFragments(x.db,x.config,x.a.id,'Newsletter').humanContributions.length,0);
 }finally{x.close();}
});
test('assertion HTTP routes return authorized history and reject stale writes and revoked users',async()=>{
 const x=await setup();try{
 await new Promise(resolve=>x.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+x.server.address().port;
 const headers=id=>({authorization:'Bearer dev.'+Buffer.from(JSON.stringify({sub:id,scope:''})).toString('base64url'),'content-type':'application/json'}),path=base+'/v1/tenants/'+x.a.id+'/brain/assertions';
 const res=await fetch(path,{method:'POST',headers:headers('owner'),body:JSON.stringify(x.input)});assert.equal(res.status,201);const a=await res.json();
 assert.equal((await fetch(path+'/'+a.id,{headers:headers('studio')})).status,200);
 assert.equal((await fetch(path+'/'+a.id,{method:'PUT',headers:headers('studio'),body:JSON.stringify({...x.input,expectedVersion:0})})).status,409);
 x.service.revokeMembership(x.a.id,'studio',admin);assert.equal((await fetch(path,{headers:headers('studio')})).status,403);
 }finally{if(x.server.listening)await new Promise(resolve=>x.server.close(resolve));x.close();}
});
