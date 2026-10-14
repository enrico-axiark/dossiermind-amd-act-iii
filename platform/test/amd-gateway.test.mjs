// Contract fixtures for the transport. No model/GPU is contacted in these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {AmdGateway} from '../src/amd-gateway.mjs';
import {DatabaseSync} from 'node:sqlite';
const fixtureDatabases=[];
const gatewayFor=(config,options={})=>{const db=new DatabaseSync(':memory:');fixtureDatabases.push(db);return new AmdGateway(config,{db,...options});};
test.after(()=>fixtureDatabases.forEach(db=>db.close()));
const config={nodeEnv:'test',amdInferenceEnabled:true,amdBaseUrl:'https://approved-amd-endpoint.example/v1',amdModel:'test-fixture-model',amdModelRevision:'fixture-revision',amdBudgetConfirmed:true,amdRequestLimit:2,amdTimeoutMs:100,amdMaxOutputTokens:128};
const schema={type:'object',additionalProperties:false,required:['status'],properties:{status:{type:'string',enum:['abstain']}}},input={messages:[{role:'user',content:'Synthetic fixture only'}],schema};
const envelope=patch=>({model:config.amdModel,choices:[{finish_reason:'stop',message:{content:'{"status":"abstain"}'}}],...patch});
test('reasoning effort is explicitly configured, omitted by default, and included in the reserved payload',async()=>{
 for(const effort of ['', 'none','low']){let body;
  const gateway=gatewayFor({...config,amdReasoningEffort:effort},{fetchImpl:async(_url,request)=>{body=JSON.parse(request.body);return Response.json(envelope());}});
  await gateway.complete(input);assert.equal(body.reasoning_effort,effort||undefined);
 }
 for(const effort of ['automatic','false',false,{}])assert.throws(()=>gatewayFor({...config,amdReasoningEffort:effort}),e=>e.code==='ai_configuration_invalid');
});
test('gateway defaults off and never sends a request without confirmed pinned configuration',async()=>{
 let calls=0;const gateway=gatewayFor({amdInferenceEnabled:false},{fetchImpl:async()=>{calls++;}});await assert.rejects(gateway.complete(input),error=>error.code==='ai_not_configured');assert.equal(calls,0);assert.equal(gateway.readiness().hardwareVerified,false);
 for(const patch of [{amdBudgetConfirmed:false},{amdModelRevision:''},{amdBaseUrl:'https://user:password@example.test/v1'},{amdBaseUrl:'https://example.test/v1?key=secret'},{amdBaseUrl:'http://remote.example/v1'},{amdRequestLimit:0}])assert.throws(()=>gatewayFor({...config,...patch}));
 assert.throws(()=>gatewayFor({...config,nodeEnv:'production',amdBaseUrl:'http://127.0.0.1:8000/v1'}));assert.doesNotThrow(()=>gatewayFor({...config,amdBaseUrl:'http://127.0.0.1:8000/v1'}));
});
test('gateway uses only the pinned endpoint/model and returns validated JSON, null missing usage, no fabricated hardware proof',async()=>{
 let observed;const gateway=gatewayFor({...config,amdApiKey:'fixture-not-a-real-secret'},{fetchImpl:async(url,request)=>{observed={url,request};return Response.json(envelope());}}),result=await gateway.complete(input);
 assert.equal(observed.url,config.amdBaseUrl+'/chat/completions');assert.equal(observed.request.redirect,'error');assert.equal(observed.request.headers.authorization,'Bearer fixture-not-a-real-secret');const body=JSON.parse(observed.request.body);assert.equal(body.model,config.amdModel);assert.equal(body.max_tokens,128);assert.equal(body.response_format.type,'json_schema');assert.deepEqual(body.response_format.json_schema.schema,schema);assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.tools,undefined);assert.deepEqual(result.output,{status:'abstain'});assert.equal(result.metadata.usage,null);assert.equal(result.metadata.hardwareVerified,false);
 await gateway.complete(input);await assert.rejects(gateway.complete(input),error=>error.code==='ai_request_cap_reached');assert.equal(gateway.calls,2);
});
test('explicit response model alias preserves request identity and rejects unconfigured aliases',async()=>{
 const alias='self-dploy/'+config.amdModel;let requested;
 const gateway=gatewayFor({...config,amdResponseModel:alias},{fetchImpl:async(_url,request)=>{requested=JSON.parse(request.body).model;return Response.json(envelope({model:alias}));}});
 const result=await gateway.complete(input);assert.equal(requested,config.amdModel);assert.equal(result.metadata.model,config.amdModel);assert.equal(result.metadata.responseModel,alias);
 const strict=gatewayFor(config,{fetchImpl:async()=>Response.json(envelope({model:alias}))});await assert.rejects(strict.complete(input),e=>e.code==='ai_response_model_mismatch');
 const other=gatewayFor({...config,amdResponseModel:alias},{fetchImpl:async()=>Response.json(envelope({model:'another-prefix/'+config.amdModel}))});await assert.rejects(other.complete(input),e=>e.code==='ai_response_model_mismatch');
});
test('gateway rejects truncated output, wrong model, schema violations, tools and oversized responses without provider fallback',async()=>{
 for(const [response,code] of [
  [envelope({model:'wrong-model'}),'ai_response_model_mismatch'],
  [envelope({choices:[{finish_reason:'length',message:{content:'{"status":"abstain"}'}}]}),'ai_output_truncated'],
  [envelope({choices:[{finish_reason:'stop',message:{content:'{"status":"made-up"}'}}]}),'ai_output_schema_invalid'],
  [envelope({choices:[{finish_reason:'stop',message:{content:'private-invalid-json'}}]}),'ai_output_json_invalid'],
  [envelope({choices:[{finish_reason:'stop',message:{content:'{"status":"abstain"}',tool_calls:[{}]}}]}),'ai_output_envelope_invalid'],
  [envelope({choices:[null]}),'ai_output_envelope_invalid'],[null,'ai_output_envelope_invalid']
 ]){let calls=0;const gateway=gatewayFor(config,{fetchImpl:async()=>{calls++;return Response.json(response);}});await assert.rejects(gateway.complete(input),error=>error.code===code&&!JSON.stringify(error).includes('private-invalid-json'));assert.equal(calls,1);assert.equal(gateway.ledger.summary().unresolved,false);assert.equal(gateway.ledger.summary().remainingRequests,1);}

 const big=gatewayFor(config,{fetchImpl:async()=>new Response('x'.repeat(300000))});await assert.rejects(big.complete(input),error=>error.code==='ai_output_limit');
 const error=gatewayFor(config,{fetchImpl:async()=>new Response('private provider diagnostic',{status:429})});await assert.rejects(error.complete(input),error=>error.code==='ai_provider_limit_error'&&!error.message.includes('private'));
});
test('provider failures distinguish access, quota, limits, availability and request errors without leaking diagnostics or replaying calls',async()=>{
 for(const [status,code] of [[401,'ai_provider_auth_error'],[403,'ai_provider_auth_error'],[402,'ai_provider_quota_error'],[429,'ai_provider_limit_error'],[500,'ai_provider_unavailable'],[502,'ai_provider_unavailable'],[503,'ai_provider_unavailable'],[504,'ai_provider_unavailable'],[400,'ai_provider_request_error'],[404,'ai_provider_request_error'],[413,'ai_provider_request_error'],[422,'ai_provider_request_error'],[418,'ai_provider_error']]){
  let calls=0,bodyReads=0;
  const gateway=gatewayFor(config,{fetchImpl:async()=>{calls++;return {ok:false,status,body:{cancel:async()=>{}},json:async()=>{bodyReads++;throw new Error('private provider body');}};}});
  await assert.rejects(gateway.complete(input,{requestId:'rejected-request'}),error=>error.code===code&&error.status===502&&error.details.providerHttpStatus===status&&!JSON.stringify(error).includes('private'));
  assert.equal(calls,1);assert.equal(bodyReads,0);assert.equal(gateway.active,false);
  assert.equal(gateway.ledger.summary().remainingRequests,1);
  assert.equal(gateway.ledger.summary().unresolved,false);
  assert.equal(gateway.ledger.db.prepare('SELECT state FROM inference_dispatches WHERE id=?').get('rejected-request').state,'failed');
  await assert.rejects(gateway.complete(input,{requestId:'rejected-request'}),error=>error.code==='ai_request_already_dispatched');
  assert.equal(calls,1);
 }
});
test('schema rejection carries bounded safe field diagnostics without raw response values',async()=>{
 const gateway=gatewayFor(config,{fetchImpl:async()=>Response.json(envelope({choices:[{finish_reason:'stop',message:{content:'{"status":"private-model-value","private-key":"secret"}'}}]}))});
 await assert.rejects(gateway.complete(input),error=>{
  assert.equal(error.code,'ai_output_schema_invalid');
  assert.deepEqual(error.details.schemaFailures,[{path:'$.status',kind:'enum mismatch'},{path:'$',kind:'additional property'}]);
  assert(!JSON.stringify(error).includes('private'));
  return true;
 });
});
test('timeout and user cancellation fail explicitly; a simultaneous request is blocked and never becomes another provider call',async()=>{
 let calls=0;const gateway=gatewayFor(config,{fetchImpl:async(_url,{signal})=>{calls++;return new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(new Error('private network diagnostic')),{once:true});});}});
 const running=gateway.complete(input);await assert.rejects(gateway.complete(input),error=>error.code==='ai_busy');await assert.rejects(running,error=>error.code==='ai_timeout');assert.equal(calls,1);assert.equal(gateway.active,false);
 const controller=new AbortController();controller.abort();await assert.rejects(gateway.complete(input,{signal:controller.signal}),error=>error.code==='ai_cancelled');assert.equal(calls,1);
});

// Captured live failure category: $.missingInformation required (14 October).
test('Advisor omitted empty missing-information list is normalized only for answers with facts, never abstention or malformed values',async()=>{
 const {advisorAnswerSchema,validateBusinessAnswer}=await import('../src/advisor-jobs.mjs');
 const answer={status:'answer',facts:[{evidenceId:'E1',quote:'Original quoted passage'}],interpretations:[],recommendations:[],scenarios:[]};
 const response=output=>Response.json(envelope({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}));
 const make=output=>gatewayFor(config,{fetchImpl:async()=>response(output)});
 const request={...input,name:'advisor_answer',schema:advisorAnswerSchema};
 const valid=await make(answer).complete(request);
 assert.deepEqual(valid.output.missingInformation,[]);assert.deepEqual(valid.metadata.outputNormalization,['absent-missingInformation-as-empty-list']);
 assert.equal(valid.output.facts[0].quote,answer.facts[0].quote);
 for(const output of [{...answer,status:'abstain',facts:[]},{...answer,missingInformation:null},{...answer,interpretations:undefined}])await assert.rejects(make(output).complete(request),e=>e.code==='ai_output_schema_invalid');
 await assert.rejects(make(answer).complete({...request,name:'document_memory'}),e=>e.code==='ai_output_schema_invalid');
 assert.throws(()=>validateBusinessAnswer(valid.output,{evidence:[{evidenceId:'E1',text:'Different original passage',reference:{}}]}),e=>e.code==='advisor_citation_invalid');
});
