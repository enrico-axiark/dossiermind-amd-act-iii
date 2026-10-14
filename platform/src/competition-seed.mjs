import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,basename} from 'node:path';
import {createHash,createHmac} from 'node:crypto';
import {assert} from './errors.mjs';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const VERSION='competition-synthetic-v1';
const scopes=['tenant:read','documents:read','documents:write','documents:delete','jobs:read','jobs:write','audit:read'];
const mime={'.pdf':'application/pdf','.csv':'text/csv','.xml':'application/xml','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.eml':'message/rfc822','.jpg':'image/jpeg'};
const fingerprint=(key)=>createHmac('sha256',key).update(VERSION).digest('hex');

// One-time, resumable installation. Never imports a local database, real files,
// stored model responses or the local inference ledger. No remote inference.
export function seedCompetition(db,service,config,{root=ROOT}={}){
 if(!config.competitionSeedEnabled)return {seeded:false};
 assert(config.competitionAccessEnabled&&!config.allowInsecureDevAuth,503,'competition_seed_invalid','Synthetic production seed requires competition access');
 db.exec('CREATE TABLE IF NOT EXISTS competition_seed (id TEXT PRIMARY KEY, state TEXT NOT NULL, master_check TEXT NOT NULL, audit_check TEXT NOT NULL)');
 let marker=db.prepare('SELECT * FROM competition_seed WHERE id=?').get(VERSION);
 const masterCheck=fingerprint(config.masterKey),auditCheck=fingerprint(config.auditKey);
 if(marker){
  assert(marker.master_check===masterCheck&&marker.audit_check===auditCheck,503,'competition_keys_changed','Persistent encryption/audit keys changed; do not overwrite the existing archive');
  if(marker.state==='complete')return {seeded:false,alreadyInstalled:true};
 }else{
  assert(db.prepare('SELECT COUNT(*) AS n FROM organizations').get().n===0&&db.prepare('SELECT COUNT(*) AS n FROM users').get().n===0,503,'competition_seed_invalid','One-time seed requires an empty archive');
 }
 const manifest=JSON.parse(readFileSync(resolve(root,'datasets/manifest.json'),'utf8'));
 assert(manifest.synthetic===true&&Array.isArray(manifest.files)&&manifest.files.length===22,503,'competition_seed_invalid','Pinned synthetic manifest required');
 const files=manifest.files.map(row=>{
  assert(row.synthetic===true&&['pmi','privato'].includes(row.tenant_key)&&new RegExp('^datasets/'+row.tenant_key+'/[a-z0-9-]+\\.(pdf|csv|xml|xlsx|eml|jpg)$').test(row.path),503,'competition_seed_invalid','Invalid synthetic dataset path');
  const bytes=readFileSync(resolve(root,row.path));assert(bytes.length===row.bytes&&createHash('sha256').update(bytes).digest('hex')===row.sha256,503,'competition_seed_invalid','Synthetic fixture digest mismatch');
  return {...row,bytes};
 });
 assert(new Set(files.map(x=>x.path)).size===22,503,'competition_seed_invalid','Duplicate synthetic source');
 if(!marker)db.prepare('INSERT INTO competition_seed VALUES (?,?,?,?)').run(VERSION,'installing',masterCheck,auditCheck);
 const admin={id:'competition-seed',type:'service',scopes:new Set(['platform:admin'])};
 let org=db.prepare("SELECT id FROM organizations WHERE name='ACT III synthetic demo'").get();
 if(!org)org=service.createOrganization({name:'ACT III synthetic demo',type:'studio'},admin);
 for(const [id,displayName] of [['owner_pmi','Aurora Demo'],['owner_privato','Giulia Demo'],['studio_demo','Studio Demo']])if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(id))service.createUser({id,email:id+'@example.test',displayName},admin);
 for(const [kind,name] of [['pmi','Aurora Demo SRL'],['privato','Giulia Demo']]){
  let tenant=db.prepare('SELECT id FROM tenants WHERE organization_id=? AND external_id=?').get(org.id,kind);
  if(!tenant)tenant=service.createTenant({organizationId:org.id,externalId:kind,name},admin);
  for(const [userId,role] of [['owner_'+kind,'owner'],['studio_demo','accountant']])if(!db.prepare('SELECT 1 FROM memberships WHERE tenant_id=? AND user_id=?').get(tenant.id,userId)&&!db.prepare('SELECT 1 FROM consents WHERE tenant_id=? AND user_id=?').get(tenant.id,userId))service.addMembership(tenant.id,{userId,role,scopes},admin);
  const principal={id:'owner_'+kind,type:'user',scopes:new Set()};
  const documentIds=[];
  for(const row of files.filter(x=>x.tenant_key===kind)){
   const filename=basename(row.path),suffix=filename.slice(filename.lastIndexOf('.'));
   const doc=service.uploadDocument(tenant.id,{filename,mimeType:mime[suffix],bytes:row.bytes,idempotencyKey:VERSION+':'+row.path},principal);documentIds.push(doc.id);
  }
  service.createJob(tenant.id,{type:'ingestion',input:{documentIds}},principal);
 }
 db.prepare('UPDATE competition_seed SET state=? WHERE id=?').run('complete',VERSION);
 return {seeded:true,documentCount:files.length};
}
