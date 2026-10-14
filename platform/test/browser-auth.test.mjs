import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {BrowserAuth} from '../src/browser-auth.mjs';
import {createPlatformApp} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const issuer='https://browser-identity.invalid',origin='https://dossiermind.invalid';
const config={oidcClientId:'demo-web',oidcIssuer:issuer,oidcAudience:'dossiermind-api',oidcAuthorizationUrl:issuer+'/authorize',oidcTokenUrl:issuer+'/token',oidcBrowserScope:'openid',publicBaseUrl:origin,allowInsecureDevAuth:false};
const now=()=>Math.floor(Date.now()/1000);
function signed(aud,extra={}){const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),header=enc({alg:'RS256',kid:'browser-test'}),payload=enc({iss:issuer,aud,sub:'owner',iat:now(),exp:now()+600,...extra});return header+'.'+payload+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+payload),keys.privateKey).toString('base64url');}
const request=(cookie='',method='GET',headers={})=>({method,headers:{cookie,...headers}});
const value=cookie=>cookie.split(';')[0];
async function setup(run){
 const saved=globalThis.fetch;
 globalThis.fetch=async(url)=>{url=String(url);if(url.endsWith('/.well-known/openid-configuration'))return Response.json({issuer,jwks_uri:issuer+'/keys'});if(url===issuer+'/keys')return Response.json({keys:[{...keys.publicKey.export({format:'jwk'}),kid:'browser-test',alg:'RS256'}]});throw Error('Unexpected network destination');};
 let expectedNonce,challenge,changes={},exchangeCount=0;
 const browser=new BrowserAuth(config,{fetcher:async(url,options)=>{
  exchangeCount++;assert.equal(url,issuer+'/token');assert.equal(options.redirect,'error');assert.equal(options.body.get('redirect_uri'),origin+'/v1/auth/callback');
  assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'),challenge);
  return Response.json({token_type:'Bearer',id_token:signed('demo-web',{nonce:expectedNonce,...changes}),access_token:signed('dossiermind-api')});
 }});
 async function start(){const result=await browser.begin(request());const url=new URL(result.location);expectedNonce=url.searchParams.get('nonce');challenge=url.searchParams.get('code_challenge');assert.equal(url.searchParams.get('code_challenge_method'),'S256');const callback=new URL(origin+'/v1/auth/callback');callback.searchParams.set('state',url.searchParams.get('state'));callback.searchParams.set('code','test-code');return {result,callback,cookie:value(result.cookies[0])};}
 try{await run({browser,start,setChanges:x=>{changes=x;},exchanges:()=>exchangeCount});}finally{globalThis.fetch=saved;}
}
test('PKCE login binds browser state and nonce, verifies signed tokens, keeps tokens server-side; CSRF and logout enforced',async()=>setup(async({browser,start})=>{
 const flow=await start(),result=await browser.callbackResult(request(flow.cookie),flow.callback);
 assert.equal(result.location,'/app/');assert.equal(result.cookies.every(c=>c.includes('HttpOnly; Secure; SameSite=Lax')),true);
 const cookie=value(result.cookies[1]);const status=await browser.status(request(cookie));assert.equal(status.id,'owner');assert.equal(Object.hasOwn(status,'token'),false);
 assert.equal((await browser.principal(request(cookie))).id,'owner');
 assert.throws(()=>browser.resolve(request(cookie,'POST',{origin:'https://evil.invalid','x-csrf-token':status.csrfToken})),e=>e.code==='csrf_failed');
 assert.throws(()=>browser.resolve(request(cookie,'POST',{origin})),e=>e.code==='csrf_failed');
 assert.equal(browser.resolve(request(cookie,'POST',{origin,'x-csrf-token':status.csrfToken})).csrf,status.csrfToken);
 await assert.rejects(browser.callbackResult(request(flow.cookie),flow.callback),e=>e.code==='invalid_login_state');
 const clears=browser.logout(request(cookie,'POST',{origin,'x-csrf-token':status.csrfToken}));assert.equal(clears.every(x=>x.includes('Max-Age=0')),true);
 await assert.rejects(browser.principal(request(cookie)),e=>e.code==='authentication_required');
}));
test('wrong browser, nonce, subject and expired state fail without publishing a session',async()=>setup(async({browser,start,setChanges,exchanges})=>{
 let flow=await start();await assert.rejects(browser.callbackResult(request(),flow.callback),e=>e.code==='invalid_login_state');assert.equal(exchanges(),0);
 for(const changes of [{nonce:'wrong'},{sub:'different'},{azp:'different'}]){flow=await start();setChanges(changes);await assert.rejects(browser.callbackResult(request(flow.cookie),flow.callback),e=>e.status===401);assert.equal(browser.sessions.size,0);}
 flow=await start();browser.clock=()=>Date.now()+301000;await assert.rejects(browser.callbackResult(request(flow.cookie),flow.callback),e=>e.code==='invalid_login_state');
}));
test('browser login configuration is fail closed with dev auth, insecure origin and foreign token endpoint',()=>{
 for(const change of [{allowInsecureDevAuth:true},{publicBaseUrl:'http://dossiermind.invalid'},{oidcTokenUrl:'https://evil.invalid/token'}])assert.throws(()=>new BrowserAuth({...config,...change}),e=>e.code==='browser_login_not_configured');
 const disabled=new BrowserAuth({});assert.throws(()=>disabled.resolve(request()),e=>e.code==='browser_login_not_configured');
});

test('HTTP browser routes publish only mode, redirect with secure state cookie, and refuse missing session or dev access',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'dossiermind-login-http-'));
 const app=createPlatformApp(loadConfig({...config,nodeEnv:'test',baseDir:directory}));
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+app.server.address().port;
 try{
  let response=await fetch(base+'/v1/auth/config');assert.deepEqual(await response.json(),{mode:'oidc'});
  response=await fetch(base+'/v1/auth/login',{redirect:'manual'});assert.equal(response.status,302);assert.equal(new URL(response.headers.get('location')).origin,issuer);assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
  response=await fetch(base+'/v1/auth/callback?code=unbound&state=unknown');assert.equal(response.status,401);
  response=await fetch(base+'/v1/auth/session');assert.equal(response.status,401);
  response=await fetch(base+'/v1/me');assert.equal(response.status,401);
  response=await fetch(base+'/v1/dev/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'client',profile:'pmi'})});assert.equal(response.status,404);
 }finally{await new Promise(resolve=>app.server.close(resolve));app.db.close();rmSync(directory,{recursive:true,force:true});}
});

test('HTTP complete login opens only live memberships, protects writes, revokes access and invalidates logout cookie',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'dossiermind-login-complete-')),originalFetch=globalThis.fetch;
 let nonce,challenge,exchangeCount=0;
 globalThis.fetch=async(url,options)=>{
  url=String(url);
  if(url===issuer+'/token'){
   exchangeCount++;assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'),challenge);
   return Response.json({token_type:'Bearer',id_token:signed('demo-web',{nonce}),access_token:signed('dossiermind-api')});
  }
  if(url===issuer+'/.well-known/openid-configuration')return Response.json({issuer,jwks_uri:issuer+'/keys'});
  if(url===issuer+'/keys')return Response.json({keys:[{...keys.publicKey.export({format:'jwk'}),kid:'browser-test',alg:'RS256'}]});
  throw Error('Unexpected provider destination');
 };
 let app;
 try{
  app=createPlatformApp(loadConfig({...config,nodeEnv:'test',baseDir:directory}));
  const admin={id:'admin',type:'user',scopes:new Set(['platform:admin'])};
  const organization=app.service.createOrganization({name:'TEST'},admin);
  app.service.createUser({id:'owner',email:'owner@example.test',displayName:'Owner TEST'},admin);
  const allowed=app.service.createTenant({organizationId:organization.id,name:'Allowed TEST'},admin),other=app.service.createTenant({organizationId:organization.id,name:'Other TEST'},admin);
  app.service.addMembership(allowed.id,{userId:'owner',role:'owner',scopes:['tenant:read','documents:read','documents:write']},admin);
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
  let response=await originalFetch(base+'/v1/auth/login',{redirect:'manual'});const flowCookie=value(response.headers.get('set-cookie')),url=new URL(response.headers.get('location'));
  nonce=url.searchParams.get('nonce');challenge=url.searchParams.get('code_challenge');
  const callback=base+'/v1/auth/callback?'+new URLSearchParams({state:url.searchParams.get('state'),code:'http-test'});
  response=await originalFetch(callback,{headers:{cookie:flowCookie},redirect:'manual'});assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/app/');
  const cookie=value(response.headers.getSetCookie().find(x=>x.startsWith('__Host-dossiermind=')));
  response=await originalFetch(base+'/v1/auth/session',{headers:{cookie}});const session=await response.json();assert.equal(session.authenticated,true);assert.equal(Object.hasOwn(session,'token'),false);
  response=await originalFetch(base+'/v1/me/tenants',{headers:{cookie}});assert.deepEqual((await response.json()).data.map(x=>x.id),[allowed.id]);
  response=await originalFetch(base+`/v1/tenants/${other.id}/documents`,{headers:{cookie}});assert.equal(response.status,403);
  const upload={method:'POST',headers:{cookie,'content-type':'text/csv','x-filename':'sample.csv'},body:'name,amount\nTEST,10\n'};
  response=await originalFetch(base+`/v1/tenants/${allowed.id}/documents`,upload);assert.equal(response.status,403);assert.equal((await response.json()).error.code,'csrf_failed');
  response=await originalFetch(base+`/v1/tenants/${allowed.id}/documents`,{...upload,headers:{...upload.headers,origin,'x-csrf-token':session.csrfToken}});assert.equal(response.status,201);
  app.service.revokeMembership(allowed.id,'owner',admin);
  response=await originalFetch(base+`/v1/tenants/${allowed.id}/documents`,{headers:{cookie}});assert.equal(response.status,403);
  response=await originalFetch(callback,{headers:{cookie:flowCookie},redirect:'manual'});assert.equal(response.status,401);assert.equal(exchangeCount,1);
  response=await originalFetch(base+'/v1/auth/logout',{method:'POST',headers:{cookie,origin,'x-csrf-token':session.csrfToken}});assert.equal(response.status,200);
  response=await originalFetch(base+'/v1/me',{headers:{cookie}});assert.equal(response.status,401);
 }finally{globalThis.fetch=originalFetch;if(app){await new Promise(resolve=>app.server.close(resolve));app.db.close();}rmSync(directory,{recursive:true,force:true});}
});
