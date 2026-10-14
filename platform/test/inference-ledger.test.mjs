// Transport/SQLite fixtures only: no actual model, GPU or credits contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {InferenceLedger} from '../src/inference-ledger.mjs';
import {AmdGateway} from '../src/amd-gateway.mjs';
const fingerprint='a'.repeat(64);
const config={nodeEnv:'test',amdInferenceEnabled:true,amdBaseUrl:'https://fixture.example/v1',amdModel:'fixture-model',amdModelRevision:'fixture-revision',amdBudgetConfirmed:true,amdRequestLimit:2,amdTimeoutMs:100,amdMaxOutputTokens:128,amdResponseFormat:'json_object'};
const schema={type:'object',additionalProperties:false,required:['status'],properties:{status:{type:'string',enum:['abstain']}}};
const input={messages:[{role:'system',content:'Use supplied original evidence only.'},{role:'user',content:'Synthetic question'}],schema};
const response=output=>Response.json({model:config.amdModel,choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]});

test('persistent reservations survive restart, failures count and cap cannot be silently changed',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dm-inference-')),path=join(dir,'ledger.sqlite');let db=new DatabaseSync(path);
 try{
  let ledger=new InferenceLedger(db,2);ledger.reserve('first',fingerprint);ledger.sent('first');ledger.finish('first','failed');db.close();db=new DatabaseSync(path);ledger=new InferenceLedger(db,2);
  assert.equal(ledger.summary().remainingRequests,1);ledger.reserve('second',fingerprint);ledger.finish('second','completed',{total_tokens:5});
  assert.throws(()=>ledger.reserve('third',fingerprint),e=>e.code==='ai_request_cap_reached');assert.throws(()=>new InferenceLedger(db,3),e=>e.code==='ai_budget_change_requires_review');assert.equal(ledger.summary().creditBalanceKnown,false);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('another process and restart cannot retry a dispatched or uncertain request',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dm-dispatch-')),path=join(dir,'ledger.sqlite');let a=new DatabaseSync(path),b=new DatabaseSync(path);
 try{
  const left=new InferenceLedger(a,2),right=new InferenceLedger(b,2);left.reserve('stable-job-id',fingerprint);left.sent('stable-job-id');
  assert.throws(()=>right.reserve('stable-job-id',fingerprint),e=>e.code==='ai_request_already_dispatched');assert.throws(()=>right.reserve('stable-job-id','b'.repeat(64)),e=>e.code==='ai_request_id_conflict');assert.throws(()=>right.reserve('other-job',fingerprint),e=>e.code==='ai_inflight_unresolved');
  a.close();a=new DatabaseSync(path);const reopened=new InferenceLedger(a,2);assert.equal(reopened.summary().unresolved,true);
  reopened.finish('stable-job-id','uncertain');assert.throws(()=>right.reserve('other-job',fingerprint),e=>e.code==='ai_inflight_unresolved');assert.equal(right.summary().reserved,1);
 }finally{a.close();b.close();rmSync(dir,{recursive:true,force:true});}
});
test('JSON object transport preserves one first system message and applies the same output checks',async()=>{
 const db=new DatabaseSync(':memory:');let sent;
 try{
  const gateway=new AmdGateway(config,{db,fetchImpl:async(_url,request)=>{sent=JSON.parse(request.body);return response({status:'abstain'});}});
  const result=await gateway.complete(input,{requestId:'json-object-1'});assert.deepEqual(sent.response_format,{type:'json_object'});assert.equal(sent.messages.filter(m=>m.role==='system').length,1);assert.ok(sent.messages[0].content.includes(JSON.stringify(schema)));assert.equal(input.messages[0].content,'Use supplied original evidence only.');assert.equal(result.metadata.protocol,'chat-completions-json_object');assert.equal(result.metadata.hardwareVerified,false);
  gateway.fetchImpl=async()=>response({status:'unsupported',invented:true});await assert.rejects(gateway.complete(input,{requestId:'json-object-2'}),e=>e.code==='ai_output_schema_invalid');assert.equal(gateway.readiness().requestBudget.remainingRequests,0);
 }finally{db.close();}
});
test('stable gateway request IDs prevent duplicate calls across gateway instances without storing question or key',async()=>{
 const db=new DatabaseSync(':memory:');let calls=0;const fetchImpl=async()=>{calls++;return response({status:'abstain'});};
 try{
  await new AmdGateway({...config,amdApiKey:'fixture-secret'},{db,fetchImpl}).complete(input,{requestId:'job-1'});
  const next=new AmdGateway(config,{db,fetchImpl});await assert.rejects(next.complete(input,{requestId:'job-1'}),e=>e.code==='ai_request_already_dispatched');assert.equal(calls,1);
  const stored=JSON.stringify(db.prepare('SELECT * FROM inference_dispatches').all());assert.ok(!stored.includes('Synthetic question'));assert.ok(!stored.includes('fixture-secret'));
  await assert.rejects(next.complete({...input,messages:[{role:'user',content:'x'},{role:'system',content:'late'}]},{requestId:'bad-order'}),e=>e.code==='ai_message_order_invalid');assert.equal(next.readiness().requestBudget.reserved,1);
 }finally{db.close();}
});
test('uncertain transport timeout blocks the next call instead of spending again after a restart',async()=>{
 const db=new DatabaseSync(':memory:');let calls=0;
 try{
  const first=new AmdGateway(config,{db,fetchImpl:async(_url,{signal})=>{calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('fixture timeout')),{once:true}));}});
  await assert.rejects(first.complete(input,{requestId:'timed-out-job'}),e=>e.code==='ai_timeout');assert.equal(first.readiness().requestBudget.unresolved,true);
  const next=new AmdGateway(config,{db,fetchImpl:async()=>{calls++;return response({status:'abstain'});}});await assert.rejects(next.complete(input,{requestId:'new-job'}),e=>e.code==='ai_inflight_unresolved');assert.equal(calls,1);
 }finally{db.close();}
});
test('known provider rejection spends one reservation and never switches endpoint or format',async()=>{
 const db=new DatabaseSync(':memory:');let calls=0;
 try{
  const gateway=new AmdGateway(config,{db,fetchImpl:async()=>{calls++;return new Response('private diagnostic',{status:502});}});
  await assert.rejects(gateway.complete(input,{requestId:'unavailable'}),e=>e.code==='ai_provider_unavailable'&&e.details.providerHttpStatus===502);assert.equal(calls,1);assert.equal(gateway.readiness().requestBudget.unresolved,false);assert.equal(gateway.readiness().requestBudget.reserved,1);
  assert.throws(()=>new AmdGateway({...config,amdResponseFormat:'automatic'},{db}),e=>e.code==='ai_configuration_invalid');assert.throws(()=>new AmdGateway(config),e=>e.code==='ai_ledger_required');
 }finally{db.close();}
});
