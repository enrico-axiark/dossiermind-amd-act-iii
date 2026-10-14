import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {createPlatformApp} from '../src/app.mjs';
import {loadConfig} from '../src/config.mjs';
import {localSession,localPackage,uiAsset} from '../src/local-ui.mjs';
const admin={id:'admin',type:'user',scopes:new Set(['platform:admin'])};
test('local UI serves connected code, live client membership and isolated synthetic package',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dm-local-ui-'));
  const config=loadConfig({nodeEnv:'test',baseDir:dir,allowInsecureDevAuth:true,masterKey:randomBytes(32),auditKey:randomBytes(32)});
  const app=createPlatformApp(config);
  try{
    const org=app.service.createOrganization({name:'Synthetic',type:'pmi'},admin);
    const tenant=app.service.createTenant({organizationId:org.id,externalId:'pmi',name:'Synthetic'},admin);
    const other=app.service.createTenant({organizationId:org.id,externalId:'privato',name:'Other'},admin);
    app.service.createUser({id:'owner_pmi',email:'pmi@example.test',displayName:'Synthetic'},admin);
    app.service.addMembership(tenant.id,{userId:'owner_pmi',role:'owner',scopes:['documents:read','tenant:read']},admin);
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+app.server.address().port;
    const html=await fetch(base+'/app/');assert.equal(html.status,200);assert.ok((await html.text()).includes('runtime.js'));assert.ok(html.headers.get('content-security-policy').includes("script-src 'self'"));
    const login=await fetch(base+'/v1/dev/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'client',profile:'pmi'})});assert.equal(login.status,200);
    const token=(await login.json()).token,headers={authorization:'Bearer '+token};
    const tenants=await (await fetch(base+'/v1/me/tenants',{headers})).json();assert.deepEqual(tenants.data.map(x=>x.id),[tenant.id]);
    const pack=await (await fetch(base+`/v1/tenants/${tenant.id}/dev-package`,{headers})).json();assert.equal(pack.data.length,11);assert.ok(pack.data.every(x=>!x.filename.includes('inspect')));
    assert.equal((await fetch(base+`/v1/tenants/${other.id}/dev-package`,{headers})).status,403);
    const pdf=await fetch(base+`/v1/tenants/${tenant.id}/dev-package/contratto-servizi.pdf`,{headers});assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
    assert.equal((await fetch(base+`/v1/tenants/${tenant.id}/dev-package/local-keys.json`,{headers})).status,404);
    app.service.revokeMembership(tenant.id,'owner_pmi',admin);
    assert.equal((await fetch(base+`/v1/tenants/${tenant.id}/dev-package`,{headers})).status,403);
  }finally{if(app.server.listening)await new Promise(resolve=>app.server.close(resolve));app.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('production rejects development identities and packages; asset routing is a fixed allowlist',()=>{
  assert.throws(()=>localSession(null,{nodeEnv:'production',allowInsecureDevAuth:true},{role:'client',profile:'pmi'}),error=>error.status===404);
  assert.throws(()=>localPackage(null,{nodeEnv:'production',allowInsecureDevAuth:true},'any'),error=>error.status===404);
  assert.equal(uiAsset('/app/../../platform/data/local-keys.json'),null);
  assert.equal(uiAsset('/app/evaluation/reference-facts.json'),null);
});
