import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createPlatformApp} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
const admin={id:'admin',type:'user',scopes:new Set(['platform:admin'])},owner={id:'reader',type:'user',scopes:new Set()};
test('AI status is tenant-authorized, reports durable job state without inference or configuration secrets',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dm-ai-status-')),config=loadConfig({nodeEnv:'test',amdInferenceEnabled:false,baseDir:dir,dbPath:'db.sqlite',storageRoot:join(dir,'objects'),allowInsecureDevAuth:true,masterKey:randomBytes(32),auditKey:randomBytes(32)}),app=createPlatformApp(config);
 try{
  app.service.createUser({id:owner.id,email:'owner@example.test',displayName:'Synthetic reader'},admin);
  const org=app.service.createOrganization({name:'Synthetic',type:'pmi'},admin),tenant=app.service.createTenant({organizationId:org.id,name:'One'},admin),other=app.service.createTenant({organizationId:org.id,name:'Two'},admin);
  app.service.addMembership(tenant.id,{userId:owner.id,role:'owner',scopes:['documents:read','jobs:write']},admin);
  const job=app.advisor.create(tenant.id,{question:'Synthetic question'},owner);
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port+'/v1/tenants/',headers={authorization:'Bearer dev.'+Buffer.from(JSON.stringify({sub:owner.id,scope:''})).toString('base64url')};
  const status=async()=>{const response=await fetch(base+tenant.id+'/ai/status',{headers});assert.equal(response.status,200);return (await response.json()).data;};
  let data=await status();assert.equal(data.state,'not_configured');assert.equal(data.counts.queued,1);assert.equal(data.configurationIsQualityProof,false);
  let budget={remainingRequests:2,unresolved:false},active=false,calls=0;
  app.advisor.gateway={get active(){return active;},readiness:()=>({enabled:true,visionEnabled:true,requestBudget:budget,privateEndpoint:'must not appear',privateKey:'must not appear'}),complete:async()=>{calls++;}};
  assert.equal((await status()).state,'queued');
  app.db.prepare("UPDATE advisor_jobs SET status='running' WHERE id=?").run(job.id);active=true;budget={remainingRequests:0,unresolved:true};data=await status();assert.equal(data.state,'working');assert.equal(data.counts.running,1);
  active=false;app.db.prepare("UPDATE advisor_jobs SET status='uncertain' WHERE id=?").run(job.id);assert.equal((await status()).state,'needs_check');
  budget={remainingRequests:0,unresolved:false};assert.equal((await status()).state,'limit_reached');
  budget={remainingRequests:2,unresolved:false};assert.equal((await status()).state,'configured');assert.equal(calls,0);
  app.advisor.gateway={readiness:()=>({configured:true,enabled:false,requestBudget:budget,privateKey:'must not appear'})};data=await status();assert.equal(data.state,'suspended');assert.equal(data.configured,true);assert.equal(calls,0);
  app.advisor.gateway={readiness:()=>({enabled:true,requestBudget:budget})};
  assert.equal(JSON.stringify(await status()).includes('must not appear'),false);
  assert.equal((await fetch(base+other.id+'/ai/status',{headers})).status,403);
  assert.equal((await fetch(base+tenant.id+'/ai/status')).status,401);
  app.service.addMembership(tenant.id,{userId:owner.id,role:'owner',scopes:['documents:read']},admin);assert.equal((await status()).configured,true);
  app.service.revokeMembership(tenant.id,owner.id,admin);assert.equal((await fetch(base+tenant.id+'/ai/status',{headers})).status,403);
 }finally{if(app.server.listening)await new Promise(resolve=>app.server.close(resolve));app.db.close();rmSync(dir,{recursive:true,force:true});}
});
