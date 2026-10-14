import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {authenticate,verifyOidcToken} from './auth.mjs';
import {assert} from './errors.mjs';

const SESSION='__Host-dossiermind', FLOW='__Host-dossiermind-flow';
const random=()=>randomBytes(32).toString('base64url');
const hash=x=>createHash('sha256').update(x).digest('base64url');
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
const cookie=(name,value,seconds)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
function cookies(request){
 const result={};for(const part of String(request.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i<0)continue;const key=part.slice(0,i).trim();assert(!Object.hasOwn(result,key),401,'invalid_session','Duplicate cookie');result[key]=part.slice(i+1).trim();}return result;
}
function secureUrl(value){const url=new URL(value);assert(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash,503,'browser_login_not_configured','Login requires pinned HTTPS URLs');return url;}

// Single-process sessions deliberately expire on restart. No tokens in the browser,
// no auto-provisioning, refresh token, account linking or permission grants.
export class BrowserAuth {
 constructor(config,{fetcher=fetch,clock=()=>Date.now()}={}){
  this.config=config;this.fetcher=fetcher;this.clock=clock;this.flows=new Map();this.sessions=new Map();
  this.enabled=Boolean(config.oidcClientId);
  if(!this.enabled)return;
  assert(!config.allowInsecureDevAuth,503,'browser_login_not_configured','Browser OIDC cannot use development authentication');
  const base=secureUrl(config.publicBaseUrl),issuer=secureUrl(config.oidcIssuer);
  assert(base.pathname==='/'&&!base.search,503,'browser_login_not_configured','Public base must be an origin');
  this.origin=base.origin;this.callback=this.origin+'/v1/auth/callback';
  for(const value of [config.oidcAuthorizationUrl,config.oidcTokenUrl])assert(secureUrl(value).origin===issuer.origin,503,'browser_login_not_configured','Login endpoints must use issuer origin');
  assert(typeof config.oidcClientId==='string'&&config.oidcClientId.length<=256,503,'browser_login_not_configured','Invalid client ID');
  assert(String(config.oidcBrowserScope).split(' ').includes('openid'),503,'browser_login_not_configured','OpenID scope required');
 }
 requireEnabled(){assert(this.enabled,503,'browser_login_not_configured','Online login is not configured');this.prune();}
 prune(){for(const map of [this.flows,this.sessions])for(const [id,row] of map)if(row.expires<=this.clock())map.delete(id);}
 async begin(request){
  this.requireEnabled();assert(this.flows.size<1000,429,'login_capacity','Too many pending logins');
  const state=random(),binding=random(),nonce=random(),verifier=random();
  this.flows.set(hash(state),{binding:hash(binding),nonce,verifier,expires:this.clock()+300000});
  const url=new URL(this.config.oidcAuthorizationUrl);
  for(const [name,value] of Object.entries({response_type:'code',client_id:this.config.oidcClientId,redirect_uri:this.callback,scope:this.config.oidcBrowserScope,state,nonce,code_challenge:hash(verifier),code_challenge_method:'S256'}))url.searchParams.set(name,value);
  return {location:url.href,cookies:[cookie(FLOW,binding,300)]};
 }
 async callbackResult(request,url){
  this.requireEnabled();const state=url.searchParams.get('state');
  assert(typeof state==='string'&&state.length<=128&&url.searchParams.getAll('state').length===1,401,'invalid_login_state','Invalid login state');
  const id=hash(state),flow=this.flows.get(id);this.flows.delete(id);
  assert(flow&&same(flow.binding,hash(cookies(request)[FLOW]||'')),401,'invalid_login_state','Login does not belong to this browser or expired');
  assert(!url.searchParams.has('error'),401,'login_denied','Identity provider denied login');
  const code=url.searchParams.get('code');assert(typeof code==='string'&&code.length>0&&code.length<=4096&&url.searchParams.getAll('code').length===1,401,'invalid_login_code','Invalid authorization code');
  const body=new URLSearchParams({grant_type:'authorization_code',client_id:this.config.oidcClientId,redirect_uri:this.callback,code,code_verifier:flow.verifier});
  const response=await this.fetcher(this.config.oidcTokenUrl,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/x-www-form-urlencoded'},body});
  assert(response.ok&&String(response.headers.get('content-type')).includes('application/json'),503,'identity_unavailable','Identity token exchange failed');
  const chunks=[];let length=0;for await(const chunk of response.body){length+=chunk.length;if(length>65536){await response.body.cancel().catch(()=>{});assert(false,503,'identity_response_invalid','Token response too large');}chunks.push(chunk);}
  let tokens;try{tokens=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{assert(false,503,'identity_response_invalid','Invalid token response');}
  assert(tokens&&typeof tokens.token_type==='string'&&tokens.token_type.toLowerCase()==='bearer'&&typeof tokens.access_token==='string'&&typeof tokens.id_token==='string',401,'identity_response_invalid','Bearer access and ID tokens required');
  const claims=await verifyOidcToken(tokens.id_token,{...this.config,oidcAudience:this.config.oidcClientId});
  assert(same(claims.nonce,flow.nonce),401,'invalid_login_nonce','Login nonce mismatch');
  assert(typeof claims.iat==='number'&&Number.isFinite(claims.iat)&&claims.iat<=this.clock()/1000+60,401,'invalid_token','Invalid issue time');
  assert((!Array.isArray(claims.aud)||claims.aud.length===1||claims.azp===this.config.oidcClientId)&&(!claims.azp||claims.azp===this.config.oidcClientId),401,'invalid_token','Invalid authorized party');
  const principal=await authenticate({headers:{authorization:'Bearer '+tokens.access_token}},this.config);
  assert(principal.type==='user'&&principal.id===claims.sub,401,'invalid_token','Access and ID token subjects must match');
  this.prune();assert(this.sessions.size<1000,429,'login_capacity','Too many active sessions');
  const sessionId=random(),csrf=random(),expires=Math.min(claims.exp*1000,principal.rawClaims.exp*1000,this.clock()+3600000);
  assert(expires>this.clock(),401,'invalid_token','Login expired');
  const old=cookies(request)[SESSION];if(old)this.sessions.delete(hash(old));
  this.sessions.set(hash(sessionId),{token:tokens.access_token,csrf,expires});
  return {location:'/app/',cookies:[cookie(FLOW,'',0),cookie(SESSION,sessionId,Math.floor((expires-this.clock())/1000))]};
 }
 resolve(request){
  this.requireEnabled();const id=cookies(request)[SESSION];assert(id&&id.length<=128,401,'authentication_required','Login required');
  const row=this.sessions.get(hash(id));assert(row,401,'authentication_required','Session expired');
  if(!['GET','HEAD','OPTIONS'].includes(request.method))assert(request.headers.origin===this.origin&&same(request.headers['x-csrf-token'],row.csrf),403,'csrf_failed','Session mutation requires same origin and CSRF token');
  return row;
 }
 async principal(request){const row=this.resolve(request);return authenticate({headers:{authorization:'Bearer '+row.token}},this.config);}
 async status(request){const row=this.resolve(request);const principal=await this.principal(request);return {authenticated:true,csrfToken:row.csrf,id:principal.id};}
 logout(request){this.resolve(request);this.sessions.delete(hash(cookies(request)[SESSION]));return [cookie(SESSION,'',0),cookie(FLOW,'',0)];}
}
