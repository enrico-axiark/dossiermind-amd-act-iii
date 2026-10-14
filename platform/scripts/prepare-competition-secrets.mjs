import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {passwordRecord} from '../src/competition-auth.mjs';

// Run locally, never during a build or service restart. Output must remain
// outside this source checkout. Passwords are not printed or put in the env file.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const target=process.argv[2]&&resolve(process.argv[2]);
if(!target||target===root||target.startsWith(root+'/'))throw new Error('Provide a private output path outside the repository');
const passwords={},records={};
for(const id of ['owner_pmi','owner_privato','studio_demo']){passwords[id]=randomBytes(24).toString('base64url');records[id]=await passwordRecord(passwords[id]);}
const env={NODE_ENV:'production',HOST:'0.0.0.0',ALLOW_INSECURE_DEV_AUTH:'false',DB_PATH:'/app/data/dossiermind.sqlite',STORAGE_ROOT:'/app/data/objects',MASTER_KEY_B64:randomBytes(32).toString('base64'),AUDIT_KEY_B64:randomBytes(32).toString('base64'),COMPETITION_ACCESS_ENABLED:'true',COMPETITION_SEED_SYNTHETIC:'true',COMPETITION_ACCOUNTS_JSON:JSON.stringify(records),AMD_INFERENCE_ENABLED:'false',AMD_BUDGET_CONFIRMED:'false',AMD_REQUEST_LIMIT:'0',AMD_INFERENCE_BASE_URL:'https://developer.amd.com.cn/radeon/api/v1',AMD_MODEL:'DeepSeek-V4-Flash-Vision-Exp',AMD_RESPONSE_MODEL:'self-dploy/DeepSeek-V4-Flash-Vision-Exp',AMD_MODEL_REVISION:'Catalog2026-10-13;weights-unverified',AMD_RESPONSE_FORMAT:'json_object',AMD_MAX_OUTPUT_TOKENS:'4096',AMD_TIMEOUT_MS:'120000',MAX_UPLOAD_BYTES:'10485760'};
writeFileSync(target,Object.entries(env).map(([key,value])=>key+'='+value).join('\n')+'\n',{flag:'wx',mode:0o600});
writeFileSync(target+'.passwords.json',JSON.stringify({syntheticCompetitionAccounts:true,passwords},null,2)+'\n',{flag:'wx',mode:0o600});
console.log('Fresh private environment file and separate demo passwords created. No keys/passwords printed. Never commit or upload the passwords file.');
