// Synthetic local identities only; never exposed by a production login route.
import {createDatabase} from '../src/db.mjs';
import {loadConfig} from '../src/config.mjs';
import {PlatformService} from '../src/service.mjs';
const config=loadConfig();
if(!config.allowInsecureDevAuth||config.nodeEnv==='production')throw new Error('Local development authentication must be explicitly enabled.');
const db=createDatabase(config.dbPath),service=new PlatformService(db,config);
const admin={id:'local-admin',type:'user',scopes:new Set(['platform:admin'])};
try {
  let org=db.prepare("SELECT id FROM organizations WHERE name='ACT III synthetic demo'").get();
  if(!org)org=service.createOrganization({name:'ACT III synthetic demo',type:'studio'},admin);
  const users=[['owner_pmi','Aurora Demo'],['owner_privato','Giulia Demo'],['studio_demo','Studio Demo']];
  for(const [id,displayName] of users)if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(id))service.createUser({id,email:id+'@example.test',displayName},admin);
  const scopes=['tenant:read','documents:read','documents:write','documents:delete','jobs:read','jobs:write','audit:read'];
  for(const [kind,name] of [['pmi','Aurora Demo SRL'],['privato','Giulia Demo']]){
    let tenant=db.prepare('SELECT id FROM tenants WHERE organization_id=? AND external_id=?').get(org.id,kind);
    if(!tenant)tenant=service.createTenant({organizationId:org.id,externalId:kind,name},admin);
    for(const [userId,role] of [['owner_'+kind,'owner'],['studio_demo','accountant']]){
      if(!db.prepare('SELECT 1 FROM memberships WHERE tenant_id=? AND user_id=?').get(tenant.id,userId) && !db.prepare('SELECT 1 FROM consents WHERE tenant_id=? AND user_id=?').get(tenant.id,userId))service.addMembership(tenant.id,{userId,role,scopes},admin);
    }
  }
  console.log('Two synthetic clients and local identities prepared. No tokens or keys printed.');
}finally{db.close();}
