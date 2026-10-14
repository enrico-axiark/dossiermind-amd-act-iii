import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,cpSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CompetitionAuth,passwordRecord} from '../src/competition-auth.mjs';
import {seedCompetition} from '../src/competition-seed.mjs';
import {createPlatformApp} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {PlatformService} from '../src/service.mjs';

const origin='https://competition.invalid';
const passwords={owner_pmi:'synthetic-test-pmi-password-123',owner_privato:'synthetic-test-private-password-456',studio_demo:'synthetic-test-studio-password-789'};
const records={};for(const [id,password] of Object.entries(passwords))records[id]=await passwordRecord(password);
const root=fileURLToPath(new URL('../../',import.meta.url));
function config(baseDir,extra={}){return loadConfig({baseDir,nodeEnv:'production',masterKey:randomBytes(32),auditKey:randomBytes(32),publicBaseUrl:origin,competitionAccessEnabled:true,competitionAccountsJson:JSON.stringify(records),competitionSeedEnabled:true,allowInsecureDevAuth:false,...extra});}

test('competition configuration rejects insecure origins, malformed/arbitrary subjects and mixed login modes',()=>{
 const db={};const base=config('/tmp');
 for(const extra of [{publicBaseUrl:'http://competition.invalid'},{allowInsecureDevAuth:true},{oidcClientId:'other'},{competitionAccountsJson:'bad'},{competitionAccountsJson:JSON.stringify({...records,admin:records.owner_pmi})},{competitionAccountsJson:JSON.stringify({...records,owner_pmi:{salt:'invalid',digest:'invalid'}})}])assert.throws(()=>new CompetitionAuth({...base,...extra},db),e=>e.code==='competition_access_invalid');
 assert.equal(new CompetitionAuth({competitionAccessEnabled:false},db).enabled,false);
});

test('HTTP password login enforces profiles, live isolation, admin denial, CSRF, rotation, logout and no dev-token fallback',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'competition-access-')),cfg=config(directory),app=createPlatformApp(cfg);
 seedCompetition(app.db,new PlatformService(app.db,cfg),cfg);
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
 const send=(path,options={})=>fetch(base+path,options);
 const login=(role,profile,password,headers={})=>send('/v1/auth/competition',{method:'POST',headers:{origin,'content-type':'application/json','x-demo-login':'1',...headers},body:JSON.stringify({role,profile,password})});
 try{
  assert.deepEqual(await (await send('/v1/auth/config')).json(),{mode:'competition'});
  assert.equal((await send('/v1/me')).status,401);
  assert.equal((await login('client','pmi',passwords.owner_pmi,{origin:'https://evil.invalid'})).status,403);
  assert.equal((await login('client','pmi',passwords.owner_pmi,{'x-demo-login':''})).status,403);
  assert.equal((await login('admin','pmi',passwords.owner_pmi)).status,401);
  assert.equal((await login('client','pmi',passwords.studio_demo)).status,401);
  const response=await login('client','pmi',passwords.owner_pmi);assert.equal(response.status,200);
  const loginBody=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
  assert.equal(loginBody.id,'owner_pmi');assert.equal(Object.hasOwn(loginBody,'token'),false);assert.match(response.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
  const ownerTenants=(await (await send('/v1/me/tenants',{headers:{cookie}})).json()).data;assert.equal(ownerTenants.length,1);
  const privateTenant=app.db.prepare("SELECT id FROM tenants WHERE external_id='privato'").get().id;
  assert.equal((await send('/v1/tenants/'+privateTenant+'/documents',{headers:{cookie}})).status,403);
  const adminMutation={method:'POST',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':loginBody.csrfToken},body:JSON.stringify({name:'forbidden',type:'studio'})};
  assert.equal((await send('/v1/admin/organizations',adminMutation)).status,403);
  assert.equal((await send('/v1/auth/logout',{method:'POST',headers:{cookie,origin}})).status,403);
  assert.equal((await send('/v1/auth/logout',{method:'POST',headers:{cookie,origin:'https://evil.invalid','x-csrf-token':loginBody.csrfToken}})).status,403);
  const rotated=await login('client','pmi',passwords.owner_pmi,{cookie});assert.equal(rotated.status,200);
  assert.equal((await send('/v1/me',{headers:{cookie}})).status,401);
  const newCookie=rotated.headers.get('set-cookie').split(';')[0],newBody=await rotated.json();
  assert.equal((await send('/v1/me',{headers:{cookie:newCookie+'; '+newCookie}})).status,401);
  app.db.prepare("UPDATE users SET status='disabled' WHERE id='owner_pmi'").run();
  assert.equal((await send('/v1/me',{headers:{cookie:newCookie}})).status,401);
  app.db.prepare("UPDATE users SET status='active' WHERE id='owner_pmi'").run();
  const logout=await send('/v1/auth/logout',{method:'POST',headers:{cookie:newCookie,origin,'x-csrf-token':newBody.csrfToken}});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await send('/v1/me',{headers:{cookie:newCookie}})).status,401);
  const studio=await login('studio','pmi',passwords.studio_demo),studioCookie=studio.headers.get('set-cookie').split(';')[0];assert.equal(studio.status,200);
  assert.equal((await (await send('/v1/me/tenants',{headers:{cookie:studioCookie}})).json()).data.length,2);
  const privateLogin=await login('client','privato',passwords.owner_privato);assert.equal(privateLogin.status,200);assert.equal((await privateLogin.json()).id,'owner_privato');
  assert.equal((await send('/v1/dev/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,404);
  assert.equal((await send('/v1/me',{headers:{authorization:'Bearer dev.'+Buffer.from(JSON.stringify({sub:'owner_pmi',scope:'platform:admin'})).toString('base64url')}})).status,401);
  assert.equal((await send('/v1/auth/login',{redirect:'manual'})).status,404);
  assert.equal((await send('/v1/auth/competition',{method:'POST',headers:{origin,'x-demo-login':'1','content-type':'application/json'},body:JSON.stringify({password:'x'.repeat(3000)})})).status,413);
 }finally{await new Promise(resolve=>app.server.close(resolve));app.db.close();rmSync(directory,{recursive:true,force:true});}
});

test('sessions expire, authentication work is bounded and repeated bad passwords are rate limited',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'competition-expiry-')),cfg=config(directory),app=createPlatformApp(cfg);seedCompetition(app.db,new PlatformService(app.db,cfg),cfg);
 let now=Date.now();const auth=new CompetitionAuth(cfg,app.db,{clock:()=>now});const request={method:'POST',headers:{origin,'x-demo-login':'1'}};
 try{
  auth.busy=true;await assert.rejects(auth.login(request,{role:'client',profile:'pmi',password:passwords.owner_pmi}),e=>e.code==='demo_login_busy');auth.busy=false;
  const result=await auth.login(request,{role:'client',profile:'pmi',password:passwords.owner_pmi}),cookie=result.cookies[0].split(';')[0];
  assert.equal((await auth.status({method:'GET',headers:{cookie}})).id,'owner_pmi');now+=3600001;
  await assert.rejects(auth.status({method:'GET',headers:{cookie}}),e=>e.code==='authentication_required');
  // Fill the attempt limit without repeatedly allocating scrypt memory.
  auth.attempts.set('owner_pmi',{count:10,expires:now+10000});
  await assert.rejects(auth.login(request,{role:'client',profile:'pmi',password:passwords.owner_pmi}),e=>e.code==='demo_login_limit');
 }finally{app.db.close();rmSync(directory,{recursive:true,force:true});}
});

test('one-time synthetic seed preserves deletions and memberships, queues no AI and detects changed encryption keys',()=>{
 const directory=mkdtempSync(join(tmpdir(),'competition-seed-')),cfg=config(directory),app=createPlatformApp(cfg),service=new PlatformService(app.db,cfg);
 try{
  assert.equal(seedCompetition(app.db,service,{...cfg,competitionSeedEnabled:false}).seeded,false);
  const result=seedCompetition(app.db,service,cfg);assert.equal(result.documentCount,22);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM documents').get().n,22);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM users').get().n,3);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM jobs').get().n,2);
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM jobs WHERE type!='ingestion'").get().n,0);
  const doc=app.db.prepare('SELECT id FROM documents LIMIT 1').get();app.db.prepare("UPDATE documents SET deleted_at='2026-10-14',status='deleted' WHERE id=?").run(doc.id);
  app.db.prepare("DELETE FROM memberships WHERE user_id='studio_demo'").run();
  assert.equal(seedCompetition(app.db,service,cfg).alreadyInstalled,true);
  assert.equal(app.db.prepare("SELECT status FROM documents WHERE id=?").get(doc.id).status,'deleted');
  assert.equal(app.db.prepare("SELECT COUNT(*) n FROM memberships WHERE user_id='studio_demo'").get().n,0);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM jobs').get().n,2);
  assert.throws(()=>seedCompetition(app.db,service,{...cfg,masterKey:randomBytes(32)}),e=>e.code==='competition_keys_changed');
 }finally{app.db.close();rmSync(directory,{recursive:true,force:true});}
});

test('seed rejects tampered fixtures before creating users or importing documents',()=>{
 const directory=mkdtempSync(join(tmpdir(),'competition-tamper-')),fixtures=join(directory,'fixtures'),cfg=config(directory),app=createPlatformApp(cfg);
 try{
  cpSync(join(root,'datasets'),join(fixtures,'datasets'),{recursive:true});
  const path=join(fixtures,'datasets/manifest.json'),manifest=JSON.parse(readFileSync(path));manifest.files[0].sha256='0'.repeat(64);writeFileSync(path,JSON.stringify(manifest));
  assert.throws(()=>seedCompetition(app.db,new PlatformService(app.db,cfg),cfg,{root:fixtures}),e=>e.code==='competition_seed_invalid');
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM users').get().n,0);assert.equal(app.db.prepare('SELECT COUNT(*) n FROM documents').get().n,0);
 }finally{app.db.close();rmSync(directory,{recursive:true,force:true});}
});
