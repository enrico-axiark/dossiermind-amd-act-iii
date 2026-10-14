import {createHash, randomBytes, scrypt, timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {assert} from './errors.mjs';

const derive=promisify(scrypt);
const HASH_OPTIONS={N:131072,r:8,p:1,maxmem:160*1024*1024};
const COOKIE='__Host-dossiermind-demo';
const random=()=>randomBytes(32).toString('base64url');
const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const cookie=(value,age)=>`${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
const IDS=['owner_pmi','owner_privato','studio_demo'];

export async function passwordRecord(password){
 assert(typeof password==='string'&&password.length>=20&&password.length<=256,400,'invalid_demo_password','Use a random password with at least 20 characters');
 const salt=randomBytes(32).toString('hex');
 const digest=(await derive(password,salt,32,HASH_OPTIONS)).toString('hex');
 return {salt,digest};
}

// Explicit competition access only. Three synthetic accounts, no registration,
// arbitrary subject selection, bearer tokens, admin scope or password recovery.
export class CompetitionAuth {
 constructor(config,db,{clock=()=>Date.now()}={}){
  this.enabled=config.competitionAccessEnabled===true;this.db=db;this.clock=clock;
  this.sessions=new Map();this.attempts=new Map();this.busy=false;
  if(!this.enabled)return;
  assert(!config.allowInsecureDevAuth&&!config.oidcClientId,503,'competition_access_invalid','Competition login cannot be combined with development or OIDC login');
  let base,records;try{base=new URL(config.publicBaseUrl);records=JSON.parse(config.competitionAccountsJson);}catch{assert(false,503,'competition_access_invalid','Competition origin and account hashes are required');}
  assert(base.protocol==='https:'&&base.pathname==='/'&&!base.search&&!base.hash&&!base.username&&!base.password,503,'competition_access_invalid','Competition access requires an HTTPS origin');
  assert(records&&typeof records==='object'&&!Array.isArray(records)&&Object.keys(records).length===3&&IDS.every(id=>Object.hasOwn(records,id)),503,'competition_access_invalid','Exactly three synthetic account hashes are required');
  for(const id of IDS)assert(records[id]&&/^[a-f0-9]{64}$/.test(records[id].salt)&&/^[a-f0-9]{64}$/.test(records[id].digest),503,'competition_access_invalid','Malformed competition password hash');
  assert(new Set(IDS.map(id=>records[id].salt)).size===3&&new Set(IDS.map(id=>records[id].digest)).size===3,503,'competition_access_invalid','Competition accounts must have distinct hashes');
  this.origin=base.origin;this.records=records;
 }
 requireEnabled(){assert(this.enabled,503,'competition_access_unavailable','Competition login is disabled');this.prune();}
 prune(){for(const [key,row] of this.sessions)if(row.expires<=this.clock())this.sessions.delete(key);for(const [key,row] of this.attempts)if(row.expires<=this.clock())this.attempts.delete(key);}
 checkOrigin(request){assert(request.headers.origin===this.origin&&(!request.headers['sec-fetch-site']||request.headers['sec-fetch-site']==='same-origin'),403,'csrf_failed','Same-origin request required');}
 sessionId(request){const values=String(request.headers.cookie||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+'='));assert(values.length===1,401,'authentication_required','Login required');const id=values[0].slice(COOKIE.length+1);assert(/^[A-Za-z0-9_-]{43}$/.test(id),401,'authentication_required','Invalid session');return hash(id);}
 limit(key,max,window){const row=this.attempts.get(key)||{count:0,expires:this.clock()+window};row.count++;this.attempts.set(key,row);assert(row.count<=max,429,'demo_login_limit','Too many login attempts; try later');}
 async login(request,input){
  this.requireEnabled();this.checkOrigin(request);
  assert(request.headers['x-demo-login']==='1',403,'csrf_failed','Explicit login header required');
  assert(input&&typeof input==='object'&&!Array.isArray(input)&&typeof input.password==='string'&&input.password.length>=1&&input.password.length<=256,401,'demo_login_failed','Invalid profile or password');
  const id=input.role==='studio'?'studio_demo':input.role==='client'&&['pmi','privato'].includes(input.profile)?'owner_'+input.profile:null;
  assert(id,401,'demo_login_failed','Invalid profile or password');
  this.limit('global',30,60000);this.limit(id,10,15*60000);
  assert(!this.busy,429,'demo_login_busy','Another login is being verified; try again shortly');
  this.busy=true;let valid;
  try{const derived=await derive(input.password,this.records[id].salt,32,HASH_OPTIONS);valid=timingSafeEqual(derived,Buffer.from(this.records[id].digest,'hex'));}finally{this.busy=false;}
  assert(valid&&this.db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(id),401,'demo_login_failed','Invalid profile or password');
  assert(this.sessions.size<1000,429,'demo_login_limit','Session capacity reached');
  // Rotate any prior session, never accept a client-chosen session identifier.
  try{this.sessions.delete(this.sessionId(request));}catch{}
  const sessionId=random(),csrf=random();this.sessions.set(hash(sessionId),{id,csrf,expires:this.clock()+3600000});
  return {cookies:[cookie(sessionId,3600)],body:{authenticated:true,id,csrfToken:csrf}};
 }
 resolve(request){
  this.requireEnabled();const row=this.sessions.get(this.sessionId(request));
  assert(row&&this.db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(row.id),401,'authentication_required','Session expired');
  if(!['GET','HEAD','OPTIONS'].includes(request.method)){this.checkOrigin(request);assert(equal(request.headers['x-csrf-token'],row.csrf),403,'csrf_failed','CSRF token required');}
  return row;
 }
 async principal(request){const row=this.resolve(request);return {id:row.id,type:'user',role:row.id==='studio_demo'?'accountant':'owner',scopes:new Set(),claimedTenantIds:new Set(),rawClaims:{sub:row.id}};}
 async status(request){const row=this.resolve(request);return {authenticated:true,id:row.id,csrfToken:row.csrf};}
 logout(request){this.resolve(request);this.sessions.delete(this.sessionId(request));return [cookie('',0)];}
}
