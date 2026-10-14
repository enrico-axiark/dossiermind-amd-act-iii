import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync,readFileSync,rmSync,cpSync,existsSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../src/db.mjs';
import { PlatformService } from '../src/service.mjs';
import { loadConfig } from '../src/config.mjs';
import { IngestionWorker,parseDocument } from '../src/ingestion.mjs';
import { authorizeTenant } from '../src/auth.mjs';
import {searchFragments,sourceGraph} from '../src/retrieval.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const python=process.env.PYTHON_EXECUTABLE||'python3';
const admin={id:'admin',type:'user',scopes:new Set(['platform:admin'])};
const member={id:'member',type:'user',scopes:new Set(['documents:read']),claimedTenantIds:new Set()};
function setup(){
  const dir=mkdtempSync(join(tmpdir(),'dm-runtime-'));
  const config=loadConfig({nodeEnv:'test',baseDir:dir,dbPath:'db.sqlite',storageRoot:join(dir,'objects'),masterKey:randomBytes(32),auditKey:randomBytes(32),pythonExecutable:python});
  const db=createDatabase(config.dbPath),service=new PlatformService(db,config);
  const org=service.createOrganization({name:'Synthetic',type:'pmi'},admin);
  const tenant=service.createTenant({organizationId:org.id,name:'Synthetic'},admin);
  service.createUser({id:member.id,email:'member@example.test',displayName:'Synthetic'},admin);
  service.addMembership(tenant.id,{userId:member.id,role:'owner',scopes:['documents:read','documents:write','jobs:write','jobs:read']},admin);
  return {dir,config,db,service,tenant,close(){db.close();rmSync(dir,{recursive:true,force:true});}};
}
function upload(ctx,file='contratto-servizi.pdf'){
  return ctx.service.uploadDocument(ctx.tenant.id,{filename:file,mimeType:'application/pdf',bytes:readFileSync(join(root,'datasets/pmi',file))},member);
}

test('PDF persists encrypted page fragments; duplicate jobs and deleted-source reupload',async()=>{
  const ctx=setup();
  try{
    const doc=upload(ctx),job=ctx.service.createJob(ctx.tenant.id,{type:'ingestion',input:{documentIds:[doc.id]}},member);
    assert.equal(ctx.service.createJob(ctx.tenant.id,{type:'ingestion',input:{documentIds:[doc.id,doc.id]}},member).id,job.id);
    await new IngestionWorker(ctx.db,ctx.config).tick();
    const result=ctx.service.getJob(ctx.tenant.id,job.id);assert.equal(result.status,'completed');assert.equal(result.output.aiExecuted,false);
    const fragments=ctx.service.getFragments(ctx.tenant.id,doc.id);assert.ok(fragments.fragments[0].text.includes('Newsletter'));assert.equal(fragments.fragments[0].locator.page,1);
    const stored=ctx.db.prepare('SELECT stored_path FROM document_extractions WHERE document_id=?').get(doc.id);
    assert.equal(readFileSync(join(ctx.config.storageRoot,stored.stored_path)).includes(Buffer.from('Newsletter')),false);
    ctx.service.deleteDocument(ctx.tenant.id,doc.id,admin);assert.equal(existsSync(join(ctx.config.storageRoot,stored.stored_path)),false);
    assert.throws(()=>ctx.service.getFragments(ctx.tenant.id,doc.id));
    const replacement=upload(ctx);assert.notEqual(replacement.id,doc.id);assert.equal(replacement.sha256,doc.sha256);
  }finally{ctx.close();}
});

test('queued job survives database reopen and expired lease is reclaimed',async()=>{
  const ctx=setup();let reopened;
  try{
    const doc=upload(ctx),job=ctx.service.createJob(ctx.tenant.id,{type:'ingestion',input:{documentIds:[doc.id]}},member);
    ctx.db.prepare("UPDATE jobs SET status='running',lease_owner='crashed',lease_until=?,attempts=1 WHERE id=?").run(Date.now()-1,job.id);
    ctx.db.close();reopened=createDatabase(ctx.config.dbPath);
    await new IngestionWorker(reopened,ctx.config).tick();
    const restored=new PlatformService(reopened,ctx.config).getJob(ctx.tenant.id,job.id);
    assert.equal(restored.status,'completed');assert.equal(restored.attempts,2);
  }finally{if(reopened)reopened.close();rmSync(ctx.dir,{recursive:true,force:true});}
});

test('revocation during actual parsing prevents publication; token claims do not restore access',async()=>{
  const ctx=setup();
  try{
    const doc=upload(ctx),job=ctx.service.createJob(ctx.tenant.id,{type:'ingestion',input:{documentIds:[doc.id]}},member);
    const parser=async(...args)=>{const parsed=await parseDocument(...args);ctx.service.revokeMembership(ctx.tenant.id,member.id,admin);return parsed;};
    await new IngestionWorker(ctx.db,ctx.config,{parser}).tick();
    assert.equal(ctx.service.getJob(ctx.tenant.id,job.id).status,'cancelled');
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM document_extractions').get().n,0);
    assert.throws(()=>authorizeTenant(ctx.db,{...member,claimedTenantIds:new Set([ctx.tenant.id])},ctx.tenant.id,'documents:read'));
  }finally{ctx.close();}
});

test('relocated offline snapshot works with relative object references and preserved key',async()=>{
  const ctx=setup();let restored;const restoreDir=mkdtempSync(join(tmpdir(),'dm-restore-'));
  try{
    const doc=upload(ctx);ctx.service.createJob(ctx.tenant.id,{type:'ingestion',input:{documentIds:[doc.id]}},member);
    await new IngestionWorker(ctx.db,ctx.config).tick();ctx.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');ctx.db.close();
    cpSync(ctx.config.dbPath,join(restoreDir,'db.sqlite'));cpSync(ctx.config.storageRoot,join(restoreDir,'objects'),{recursive:true});
    restored=createDatabase(join(restoreDir,'db.sqlite'));
    const service=new PlatformService(restored,{...ctx.config,storageRoot:join(restoreDir,'objects')});
    assert.deepEqual(service.downloadDocument(ctx.tenant.id,doc.id,admin).bytes,readFileSync(join(root,'datasets/pmi/contratto-servizi.pdf')));
    assert.ok(service.getFragments(ctx.tenant.id,doc.id).fragments.length>0);
  }finally{if(restored)restored.close();rmSync(ctx.dir,{recursive:true,force:true});rmSync(restoreDir,{recursive:true,force:true});}
});

test('scan remains needs_vision; malformed file fails explicitly without fabricated fragments',async()=>{
  const ctx=setup();
  try{
    const scan=upload(ctx,'ricevuta-scansione.pdf');const bad=ctx.service.uploadDocument(ctx.tenant.id,{filename:'bad.pdf',mimeType:'application/pdf',bytes:Buffer.from('%PDF-1.7\ntruncated')},member);
    const job=ctx.service.createJob(ctx.tenant.id,{type:'ingestion',input:{documentIds:[scan.id,bad.id]}},member);
    await new IngestionWorker(ctx.db,ctx.config).tick();const output=ctx.service.getJob(ctx.tenant.id,job.id);
    assert.equal(output.status,'completed_with_errors');assert.equal(ctx.service.getFragments(ctx.tenant.id,scan.id).status,'needs_vision');assert.equal(ctx.service.getFragments(ctx.tenant.id,scan.id).fragments.length,0);
    assert.equal(ctx.service.getFragments(ctx.tenant.id,bad.id).status,'not_processed');
  }finally{ctx.close();}
});

test('parser rejects XML entities and ZIP traversal; CSV preserves ambiguous dates and literal formula',async()=>{
  const cases=JSON.parse(readFileSync(join(root,'evaluation/parser-edge-fixtures.json'))).cases;
  const config={pythonExecutable:python,parserTimeoutMs:20000};
  for(const id of ['xml-external-entity','xml-local-entity','xlsx-traversal']){
    const c=cases.find(x=>x.id===id);await assert.rejects(parseDocument(readFileSync(join(root,c.path)),c.declared_mime,id,config));
  }
  for(const id of ['csv-ambiguous-date','csv-formula-text']){
    const c=cases.find(x=>x.id===id);const result=await parseDocument(readFileSync(join(root,c.path)),c.declared_mime,id,config);
    assert.equal(result.fragments[0].locator.row,2);assert.ok(result.warnings.some(x=>x.code===c.reason_category));
  }
});

test('both synthetic corpora parse all deterministic formats; images and scans remain pending vision',async()=>{
  const manifest=JSON.parse(readFileSync(join(root,'datasets/manifest.json')));
  const config={pythonExecutable:python,parserTimeoutMs:20000};
  for(const file of manifest.files){
    const name=file.path.split('/').at(-1);
    const mime=name.endsWith('.pdf')?'application/pdf':name.endsWith('.jpg')?'image/jpeg':name.endsWith('.csv')?'text/csv':name.endsWith('.xml')?'application/xml':name.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'message/rfc822';
    const result=await parseDocument(readFileSync(join(root,file.path)),mime,name,config);
    if(name==='ricevuta.jpg'||name==='ricevuta-scansione.pdf')assert.equal(result.status,'needs_vision',file.path);
    else assert.ok(result.fragments.length>0,file.path);
    if(name.endsWith('.xlsx'))assert.ok(result.fragments.some(x=>x.locator.cell),file.path);
    if(name.endsWith('.eml')){
      assert.ok(result.warnings.some(x=>x.code==='attachment_extracted'),file.path);
      assert.ok(result.fragments.some(x=>x.locator.attachment&&x.locator.page===1),file.path);
    }
  }
});

test('lexical retrieval and provenance graph use current client sources, with deletion propagation',async()=>{
  const ctx=setup();
  try{
    const doc=upload(ctx);ctx.service.createJob(ctx.tenant.id,{type:'ingestion',input:{documentIds:[doc.id]}},member);
    await new IngestionWorker(ctx.db,ctx.config).tick();
    const result=searchFragments(ctx.db,ctx.config,ctx.tenant.id,'Newsletter');
    assert.equal(result.totalMatches,1);assert.equal(result.data[0].documentId,doc.id);assert.equal(result.data[0].sourceHash,doc.sha256);assert.equal(result.data[0].locator.page,1);assert.equal(result.scoreMeaning,'ranking-not-confidence');
    assert.equal(searchFragments(ctx.db,ctx.config,'another-tenant','Newsletter').totalMatches,0);
    const graph=sourceGraph(ctx.db,ctx.tenant.id);assert.equal(graph.edges.length,1);assert.equal(graph.knowledgeGraphReady,false);
    ctx.service.deleteDocument(ctx.tenant.id,doc.id,admin);
    assert.equal(searchFragments(ctx.db,ctx.config,ctx.tenant.id,'Newsletter').totalMatches,0);assert.equal(sourceGraph(ctx.db,ctx.tenant.id).edges.length,0);
  }finally{ctx.close();}
});

test('partially failed ingestion can be retried after parser recovery',async()=>{
  const ctx=setup();
  try{
    const doc=upload(ctx),input={type:'ingestion',input:{documentIds:[doc.id]}};
    const first=ctx.service.createJob(ctx.tenant.id,input,member);
    await new IngestionWorker(ctx.db,ctx.config,{parser:async()=>{throw Object.assign(new Error('unavailable'),{code:'parser_unavailable'});}}).tick();
    assert.equal(ctx.service.getJob(ctx.tenant.id,first.id).status,'completed_with_errors');
    const retry=ctx.service.createJob(ctx.tenant.id,input,member);assert.notEqual(retry.id,first.id);
    await new IngestionWorker(ctx.db,ctx.config).tick();assert.equal(ctx.service.getJob(ctx.tenant.id,retry.id).status,'completed');
  }finally{ctx.close();}
});
