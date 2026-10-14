import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assert } from './errors.mjs';
const app=fileURLToPath(new URL('../../app/',import.meta.url));
const dataset=fileURLToPath(new URL('../../datasets/',import.meta.url));
export function uiAsset(pathname) {
  const name={'/app/':'index.html','/app/index.html':'index.html','/app/styles.css':'styles.css','/app/runtime.js':'runtime.js'}[pathname];
  if(!name)return null;
  const contentType=name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8';
  return {bytes:readFileSync(app+name),contentType};
}
export function localSession(db,config,{role,profile}) {
  assert(config.allowInsecureDevAuth&&config.nodeEnv!=='production',404,'not_found','Local login is unavailable');
  assert(['client','studio'].includes(role)&&['pmi','privato'].includes(profile),400,'validation_error','Invalid local identity');
  const id=role==='studio'?'studio_demo':'owner_'+profile;
  assert(db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(id),409,'local_bootstrap_required','Initialize synthetic local identities first');
  return {token:'dev.'+Buffer.from(JSON.stringify({sub:id,role,scope:'',tenant_ids:[]})).toString('base64url'),developmentOnly:true};
}
export function localPackage(db,config,tenantId,filename=null) {
  assert(config.allowInsecureDevAuth&&config.nodeEnv!=='production',404,'not_found','Local package is unavailable');
  const tenant=db.prepare('SELECT external_id FROM tenants WHERE id=?').get(tenantId);
  assert(['pmi','privato'].includes(tenant?.external_id),404,'not_found','No synthetic package for this client');
  const manifest=JSON.parse(readFileSync(dataset+'manifest.json'));
  const files=manifest.files.filter(row=>row.tenant_key===tenant.external_id);
  const mime=name=>name.endsWith('.pdf')?'application/pdf':name.endsWith('.jpg')?'image/jpeg':name.endsWith('.xml')?'application/xml':name.endsWith('.csv')?'text/csv':name.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'message/rfc822';
  if(filename===null)return {data:files.map(row=>({filename:row.path.split('/').at(-1),mimeType:mime(row.path)}))};
  const file=files.find(row=>row.path.split('/').at(-1)===filename);
  assert(file,404,'not_found','Synthetic fixture not found');
  return {bytes:readFileSync(fileURLToPath(new URL('../../'+file.path,import.meta.url))),contentType:mime(filename)};
}
