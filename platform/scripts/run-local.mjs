// Explicit loopback-only development runtime, with private persistent keys.
import {mkdirSync,readFileSync,writeFileSync,existsSync,statSync,unlinkSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const platform=fileURLToPath(new URL('../',import.meta.url));
process.chdir(platform);
const data=join(platform,'data');mkdirSync(data,{recursive:true,mode:0o700});
const keyFile=join(data,'local-keys.json');
if(!existsSync(keyFile))writeFileSync(keyFile,JSON.stringify({master:randomBytes(32).toString('base64'),audit:randomBytes(32).toString('base64')}),{mode:0o600,flag:'wx'});
const keys=JSON.parse(readFileSync(keyFile));
if(process.env.DM_AMD_LOCAL_ENGINE){
 if(!['authorized-twelve-new-calls','authorized-twenty-four-total-calls','authorized-thirty-total-calls'].includes(process.env.DM_AMD_LOCAL_ENGINE))throw new Error('Explicit AMD local-demo authorization required');
 const apiFile=process.env.DM_AMD_KEY_FILE;
 if(!apiFile||!statSync(apiFile).isFile()||(statSync(apiFile).mode&0o077))throw new Error('Private temporary AMD key file required');
 const apiKey=readFileSync(apiFile,'utf8').trim();unlinkSync(apiFile);
 if(!apiKey)throw new Error('Empty AMD credential');
 const authorizationFile=join(data,'amd-demo-authorization.json');
 const authorization={requestLimit:({'authorized-twelve-new-calls':12,'authorized-twenty-four-total-calls':24,'authorized-thirty-total-calls':30})[process.env.DM_AMD_LOCAL_ENGINE],model:'DeepSeek-V4-Flash-Vision-Exp',revision:'Catalog2026-10-13;weights-unverified',endpoint:'https://developer.amd.com.cn/radeon/api/v1',scope:'The demo owner authorized the cumulative limit recorded here for free synthetic-data calls; no replay of uncertain calls; DeepSeek Vision confirmed for the demo on 2026-10-13'};
 if(existsSync(authorizationFile)){
  const saved=JSON.parse(readFileSync(authorizationFile));
  for(const name of ['requestLimit','model','revision','endpoint'])if(saved[name]!==authorization[name])throw new Error('Stored authorization mismatch; never reset the request ledger');
 }else writeFileSync(authorizationFile,JSON.stringify({...authorization,authorizedAt:new Date().toISOString()},null,2)+'\n',{mode:0o600,flag:'wx'});
 Object.assign(process.env,{AMD_INFERENCE_ENABLED:'true',AMD_VISION_ENABLED:'true',AMD_INFERENCE_BASE_URL:authorization.endpoint,AMD_MODEL:authorization.model,AMD_RESPONSE_MODEL:'self-dploy/'+authorization.model,AMD_MODEL_REVISION:authorization.revision,AMD_VISION_MODEL:'',AMD_BUDGET_CONFIRMED:'true',AMD_REQUEST_LIMIT:String(authorization.requestLimit),AMD_API_KEY:apiKey,AMD_RESPONSE_FORMAT:'json_object',AMD_MAX_OUTPUT_TOKENS:'4096',AMD_TIMEOUT_MS:'120000'});
}
process.env.MASTER_KEY_B64=keys.master;process.env.AUDIT_KEY_B64=keys.audit;
process.env.NODE_ENV='development';process.env.HOST='127.0.0.1';process.env.ALLOW_INSECURE_DEV_AUTH='true';
await import('./bootstrap-event.mjs');
await import('../src/server.mjs');
