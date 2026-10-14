import {execFileSync} from "node:child_process";
import {writeFileSync,mkdirSync} from "node:fs";
import {downloadReport} from "../src/reports.mjs";
import {searchFragments,sourceGraph} from "../src/retrieval.mjs";
import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createPlatformApp} from '../src/app.mjs';import {createDatabase} from '../src/db.mjs';import {loadConfig} from '../src/config.mjs';import {IngestionWorker} from '../src/ingestion.mjs';import {CalculationMemory} from '../src/calculation-memory.mjs';import {derivedArtifactSchema,schemaIssues} from '../src/contracts.mjs';import {reportSnapshot} from '../src/reports.mjs';
const admin={id:'admin',type:'user',scopes:new Set(['platform:admin'])},user={id:'owner',type:'user',scopes:new Set(),claimedTenantIds:new Set()};
async function setup(){const dir=mkdtempSync(join(tmpdir(),'dm-memory-')),config=loadConfig({nodeEnv:'test',baseDir:dir,dbPath:'db.sqlite',storageRoot:join(dir,'objects'),allowInsecureDevAuth:true,masterKey:randomBytes(32),auditKey:randomBytes(32),pythonExecutable:process.env.PYTHON_EXECUTABLE||'python3'}),app=createPlatformApp(config),org=app.service.createOrganization({name:'Synthetic',type:'pmi'},admin),tenant=app.service.createTenant({organizationId:org.id,name:'Synthetic'},admin);app.service.createUser({id:user.id,email:'owner@example.test',displayName:'Synthetic'},admin);app.service.addMembership(tenant.id,{userId:user.id,role:'owner',scopes:['documents:read','documents:write','jobs:write']},admin);const doc=app.service.uploadDocument(tenant.id,{filename:'bank.csv',mimeType:'text/csv',bytes:Buffer.from('date;id;description;debit;credit;balance\n2026-09-01;A;Income;0;10.01;110.01\n2026-09-02;B;Expense;0.02;0;109.99\n')},user);app.service.createJob(tenant.id,{type:'ingestion',input:{documentIds:[doc.id]}},user);await new IngestionWorker(app.db,config).tick();return {...app,dir,config,tenant,doc,memory:new CalculationMemory(app.db,config),input:{documentId:doc.id,columns:{date:'date',id:'id',description:'description',debit:'debit',credit:'credit',balance:'balance'},currency:'EUR',numberFormat:'decimal-dot',balancePosition:'after_transaction'},close(){app.db.close();rmSync(dir,{recursive:true,force:true});}};}
test('encrypted calculation memory validates derived schema, keeps raw lineage and survives database reopen',async()=>{const x=await setup();let reopened;try{const saved=x.memory.save(x.tenant.id,x.input,user);assert.equal(saved.artifact.independent_evidence,false);assert.equal(saved.artifact.review_status,'pending');assert.deepEqual(schemaIssues(saved.artifact,derivedArtifactSchema),[]);assert.equal(saved.result.totals.net.eur,'9.99');assert.equal(x.memory.save(x.tenant.id,x.input,user).reused,true);const search=searchFragments(x.db,x.config,x.tenant.id,'entrate');assert.equal(search.derived[0].independentEvidence,false);assert.equal(sourceGraph(x.db,x.tenant.id,x.config).nodes.filter(n=>n.type==='calculation').length,1);const raw=Buffer.from(x.db.prepare('SELECT body FROM calculation_memories').get().body);assert.equal(raw.includes(Buffer.from('10.01')),false);reopened=createDatabase(x.config.dbPath);assert.equal(new CalculationMemory(reopened,x.config).get(x.tenant.id,saved.id,user).result.totals.net.eur,'9.99');assert.ok(schemaIssues({...saved.artifact,independent_evidence:true},derivedArtifactSchema).length);assert.ok(schemaIssues({...saved.artifact,evidence_ids:[]},derivedArtifactSchema).length);}finally{reopened?.close();x.close();}});
test('new mapping creates superseding version; inconsistent extraction version invalidates memory and report inclusion',async()=>{
 const x=await setup();try{
  const first=x.memory.save(x.tenant.id,x.input,user);
  assert.throws(()=>x.memory.save(x.tenant.id,{...x.input,numberFormat:'decimal-comma'},user),e=>e.code==='calculation_needs_review');
  const second=x.memory.save(x.tenant.id,{...x.input,columns:{...x.input.columns,id:'description',description:'id'}},user);
  assert.equal(second.version,2);assert.equal(second.artifact.supersedes_id,first.id);assert.equal(x.memory.get(x.tenant.id,first.id,user).state,'superseded');assert.equal(x.memory.list(x.tenant.id,user).length,1);
  assert.equal(reportSnapshot(x.db,x.config,x.tenant.id).snapshot.calculations.length,1);
  x.db.prepare("UPDATE document_extractions SET parser_version='inconsistent-test-version' WHERE document_id=?").run(x.doc.id);
  assert.equal(x.memory.get(x.tenant.id,second.id,user).state,'stale');assert.equal(reportSnapshot(x.db,x.config,x.tenant.id).snapshot.calculations.length,0);
 }finally{x.close();}
});
test('revocation and cross-client references deny memory; deleting source erases history and export contains derived flag',async()=>{const x=await setup();try{const saved=x.memory.save(x.tenant.id,x.input,user);assert.throws(()=>x.memory.get('other',saved.id,user));assert.equal(x.service.exportTenant(x.tenant.id,admin).payload.calculations[0].artifact.independent_evidence,false);x.service.revokeMembership(x.tenant.id,user.id,admin);assert.throws(()=>x.memory.list(x.tenant.id,{...user,claimedTenantIds:new Set([x.tenant.id])}));x.service.deleteDocument(x.tenant.id,x.doc.id,admin);assert.equal(x.db.prepare('SELECT COUNT(*) n FROM calculation_memories').get().n,0);}finally{x.close();}});

test('HTTP saved calculations require write permission and expose full artifacts only inside the authorized client',async()=>{
 const x=await setup();try{
  await new Promise(resolve=>x.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+x.server.address().port,path=base+'/v1/tenants/'+x.tenant.id+'/brain/calculations',headers={authorization:'Bearer dev.'+Buffer.from(JSON.stringify({sub:user.id,scope:''})).toString('base64url'),'content-type':'application/json'};
  const created=await fetch(path,{method:'POST',headers,body:JSON.stringify(x.input)});assert.equal(created.status,201);const saved=await created.json();
  const detail=await fetch(path+'/'+saved.id,{headers});assert.equal(detail.status,200);assert.equal((await detail.json()).artifact.independent_evidence,false);
  x.service.addMembership(x.tenant.id,{userId:user.id,role:'owner',scopes:['documents:read']},admin);
  assert.equal((await fetch(path,{method:'POST',headers,body:JSON.stringify(x.input)})).status,403);assert.equal((await fetch(path,{headers})).status,200);
  x.service.revokeMembership(x.tenant.id,user.id,admin);assert.equal((await fetch(path+'/'+saved.id,{headers})).status,403);
 }finally{if(x.server.listening)await new Promise(resolve=>x.server.close(resolve));x.close();}
});

test('PDF incorporates current saved calculations with readable source and conditional origin',async()=>{
 const x=await setup();try{
  x.memory.save(x.tenant.id,x.input,user);const job=x.service.createJob(x.tenant.id,{type:'report',input:{kind:'document_dossier'}},user);await new IngestionWorker(x.db,x.config).tick();const result=x.service.getJob(x.tenant.id,job.id);assert.equal(result.status,'completed');
  const pdf=downloadReport(x.db,x.config,x.tenant.id,result.output.reportId,user).bytes;
  const text=execFileSync(x.config.pythonExecutable,['-c','import io,sys;from pypdf import PdfReader;print("\\n".join(p.extract_text() for p in PdfReader(io.BytesIO(sys.stdin.buffer.read())).pages))'],{input:pdf}).toString();
  assert.ok(text.includes('Calcoli salvati con fonti'));assert.ok(text.includes('10,01 EUR'));assert.ok(text.includes('Riga 2'));assert.ok(text.includes('non è una prova indipendente'));
  if(process.env.REPORT_MEMORY_PROOF){mkdirSync(join(process.env.REPORT_MEMORY_PROOF,'..'),{recursive:true});writeFileSync(process.env.REPORT_MEMORY_PROOF,pdf);}
 }finally{x.close();}
});
