import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {authenticate} from '../src/auth.mjs';

// Offline signed-token protocol tests; not a live identity-provider qualification.
const key=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...key.publicKey.export({format:'jwk'}),kid:'test-key',use:'sig',alg:'RS256'};
const now=()=>Math.floor(Date.now()/1000);
function token(issuer,changes={},headerChanges={}){
 const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const header=encode({alg:'RS256',kid:'test-key',...headerChanges});
 const payload=encode({iss:issuer,sub:'client',aud:'dossiermind-api',exp:now()+300,nbf:now()-10,scope:'documents:read',...changes});
 const signature=sign('RSA-SHA256',Buffer.from(header+'.'+payload),key.privateKey).toString('base64url');
 return header+'.'+payload+'.'+signature;
}
async function withProvider(issuer,run){
 const original=globalThis.fetch,seen=[];
 globalThis.fetch=async(url,options)=>{
  url=String(url);seen.push({url,options});
  if(url===issuer+'/.well-known/openid-configuration')return Response.json({issuer,jwks_uri:issuer+'/keys'});
  if(url===issuer+'/keys')return Response.json({keys:[jwk]});
  throw Error('Unexpected destination');
 };
 try{await run({oidcIssuer:issuer,oidcAudience:'dossiermind-api',allowInsecureDevAuth:false},seen);}finally{globalThis.fetch=original;}
}
const auth=(value,config)=>authenticate({headers:{authorization:'Bearer '+value}},config);
const denied=error=>error.status===401&&error.code==='invalid_token';

test('OIDC signed token enforces issuer, audience, signature and NumericDate; dev token cannot replace it',async()=>{
 await withProvider('https://signed-test.invalid',async(config,seen)=>{
  const accepted=await auth(token(config.oidcIssuer),config);
  assert.equal(accepted.id,'client');assert.equal(accepted.scopes.has('documents:read'),true);
  assert.equal((await auth(token(config.oidcIssuer,{aud:['other','dossiermind-api']}),config)).id,'client');
  for(const change of [{iss:'https://other.invalid'},{aud:'other'},{exp:now()-1},{exp:String(now()+300)},{exp:null},{nbf:now()+300},{nbf:'0'},{nbf:'invalid'},{sub:''}])await assert.rejects(auth(token(config.oidcIssuer,change),config),denied);
  await assert.rejects(auth(token(config.oidcIssuer,{}, {alg:'HS256'}),config),denied);
  await assert.rejects(auth(token(config.oidcIssuer,{}, {kid:'unknown'}),config),denied);
  const valid=token(config.oidcIssuer),parts=valid.split('.');parts[1]=Buffer.from(JSON.stringify({iss:config.oidcIssuer,sub:'attacker',exp:now()+300})).toString('base64url');
  await assert.rejects(auth(parts.join('.'),config),denied);
  await assert.rejects(auth('dev.'+Buffer.from(JSON.stringify({sub:'client'})).toString('base64url'),config),denied);
  assert.deepEqual(seen.map(x=>x.url),[config.oidcIssuer+'/.well-known/openid-configuration',config.oidcIssuer+'/keys']);
  assert.equal(seen.every(x=>x.options.redirect==='error'&&x.options.signal),true);
 });
});

test('OIDC discovery refuses a mismatched issuer or keys on another origin',async()=>{
 const original=globalThis.fetch;
 try{
  for(const [issuer,discovery] of [['https://wrong-issuer.invalid',{issuer:'https://other.invalid',jwks_uri:'https://wrong-issuer.invalid/keys'}],['https://wrong-keys.invalid',{issuer:'https://wrong-keys.invalid',jwks_uri:'https://other.invalid/keys'}]]){
   let calls=0;globalThis.fetch=async()=>{calls++;return Response.json(discovery);};
   await assert.rejects(auth(token(issuer),{oidcIssuer:issuer,oidcAudience:'dossiermind-api',allowInsecureDevAuth:false}),e=>e.status===503&&['oidc_issuer_mismatch','oidc_configuration_invalid'].includes(e.code));
   assert.equal(calls,1);
  }
 }finally{globalThis.fetch=original;}
});
