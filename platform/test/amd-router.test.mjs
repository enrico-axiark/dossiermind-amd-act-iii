// Offline routing fixtures, never AMD quality evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {AmdRouter} from '../src/amd-router.mjs';
const config={nodeEnv:'test',amdInferenceEnabled:true,amdBaseUrl:'https://fixture.example/v1',amdModel:'analyst-fixture',amdResponseModel:'served/analyst-fixture',amdModelRevision:'revision-one',amdBudgetConfirmed:true,amdRequestLimit:2,amdTimeoutMs:100,amdMaxOutputTokens:128,amdResponseFormat:'json_object',amdVisionEnabled:true,amdVisionModel:'vision-fixture',amdVisionResponseModel:'served/vision-fixture',amdVisionModelRevision:'revision-two',amdReasoningEffort:'none'};
const schema={type:'object',additionalProperties:false,required:['ok'],properties:{ok:{type:'boolean'}}};
const text={schema,messages:[{role:'user',content:'Synthetic fixture'}]};
const vision={...text,visual:true,messages:[{role:'user',content:[{type:'text',text:'Synthetic fixture'},{type:'image_url',image_url:{url:'data:image/png;base64,iVBORw0KGgo='}}]}]};
test('purpose routing uses exact configured model identity and one shared request cap, without fallback',async()=>{
 const db=new DatabaseSync(':memory:');try{const bodies=[],router=new AmdRouter(config,{db,fetchImpl:async(_url,request)=>{const b=JSON.parse(request.body);bodies.push(b);return Response.json({model:'served/'+b.model,choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]});}});
 const a=await router.complete(text),b=await router.complete(vision);assert.equal(a.metadata.model,'analyst-fixture');assert.equal(b.metadata.model,'vision-fixture');assert.equal(bodies[0].reasoning_effort,'none');assert.equal(bodies[1].reasoning_effort,undefined);assert.equal(router.ledger.summary().reserved,2);await assert.rejects(router.complete(text),e=>e.code==='ai_request_cap_reached');assert.equal(bodies.length,2);
 }finally{db.close();}
});
test('single-model mode is preserved; unpinned separate vision fails before any request',()=>{
 const db=new DatabaseSync(':memory:');try{const router=new AmdRouter({...config,amdVisionModel:''},{db});assert.equal(router.visual,router.text);assert.equal(router.readiness().separateVisionModel,false);assert.throws(()=>new AmdRouter({...config,amdVisionModelRevision:''},{db}),e=>e.code==='ai_configuration_invalid');
 }finally{db.close();}
});
test('text and vision cannot overlap, and a vision timeout stays uncertain in the shared ledger',async()=>{
 const db=new DatabaseSync(':memory:');try{let calls=0;const router=new AmdRouter(config,{db,fetchImpl:async(_url,{signal})=>{calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('fixture interruption')),{once:true}));}});
 const running=router.complete(vision);await assert.rejects(router.complete(text),e=>e.code==='ai_busy');await assert.rejects(running,e=>e.code==='ai_timeout');assert.equal(calls,1);assert.equal(router.ledger.summary().unresolved,true);await assert.rejects(router.complete(text),e=>e.code==='ai_inflight_unresolved');assert.equal(calls,1);
 }finally{db.close();}
});
