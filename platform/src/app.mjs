import {BrowserAuth} from './browser-auth.mjs';
import {DocumentMemory} from './document-memory.mjs';
import {contributionOptions} from './advisor-contributions.mjs';
import {AdvisorJobs} from './advisor-jobs.mjs';
import {AmdRouter} from './amd-router.mjs';
import {aiStatus} from './ai-status.mjs';
import {AssertionService} from './assertions.mjs';
import {prepareAdvisorEvidence} from './advisor-evidence.mjs';
import {appendAudit} from './audit.mjs';
import {ChecklistService} from './checklists.mjs';
import {CalculationMemory} from "./calculation-memory.mjs";
import {bankSummary} from "./calculations.mjs";
import {listReports,downloadReport} from "./reports.mjs";
import { NoteService } from "./notes.mjs";
import { ConsentService } from "./consents.mjs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createDatabase } from "./db.mjs";
import { authenticate, authorizeTenant, requireScope } from "./auth.mjs";
import { HttpError, assert } from "./errors.mjs";
import { searchFragments, sourceGraph } from "./retrieval.mjs";
import { uiAsset, localSession, localPackage } from "./local-ui.mjs";
import { PlatformService } from "./service.mjs";

function sendJson(response, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": payload.length, ...headers });
  response.end(payload);
}

function sendBytes(response, status, bytes, headers = {}) {
  response.writeHead(status, { "content-length": bytes.length, ...headers });
  response.end(bytes);
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "request_too_large", "Request body exceeds configured limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request, limit = 1024 * 1024) {
  const body = await readBody(request, limit);
  if (!body.length) return {};
  assert((request.headers["content-type"] ?? "").includes("application/json"), 415, "unsupported_media_type", "application/json is required");
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON");
  }
}

function setSecurityHeaders(request, response, config) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  const origin = request.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "Origin");
    response.setHeader("access-control-allow-headers", "authorization, content-type, idempotency-key, x-filename");
    response.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  }
}

function routeMatch(pathname, pattern) {
  const actual = pathname.split("/").filter(Boolean);
  const expected = pattern.split("/").filter(Boolean);
  if (actual.length !== expected.length) return null;
  const params = {};
  for (let i = 0; i < expected.length; i += 1) {
    if (expected[i].startsWith(":")) {
      try { params[expected[i].slice(1)] = decodeURIComponent(actual[i]); }
      catch { throw new HttpError(400, "invalid_path", "URL path contains invalid encoding"); }
    }
    else if (expected[i] !== actual[i]) return null;
  }
  return params;
}

export function createPlatformApp(config) {
  const browserAuth = new BrowserAuth(config);
  const db = createDatabase(config.dbPath);
  const service = new PlatformService(db, config);
  const advisor = new AdvisorJobs(db,config,new AmdRouter(config,{db}));
  const memory=new DocumentMemory(db,config,advisor.gateway);
  const notes = new NoteService(db,config);
  const assertions = new AssertionService(db,config);
  const checklists = new ChecklistService(db,config);
  const consentService = new ConsentService(db, config);
  // Complete only deletions already durably started; respect any new legal hold.
  const deletionRecovery=service.resumeDocumentDeletions();
  const rateBuckets = new Map();

  function enforceRateLimit(key, response) {
    const current = rateBuckets.get(key);
    const timestamp = Date.now();
    const bucket = !current || current.resetAt <= timestamp ? { count: 0, resetAt: timestamp + config.rateLimitWindowMs } : current;
    bucket.count += 1; rateBuckets.set(key, bucket);
    response.setHeader("ratelimit-limit", String(config.rateLimitMax));
    response.setHeader("ratelimit-remaining", String(Math.max(0, config.rateLimitMax - bucket.count)));
    if (bucket.count > config.rateLimitMax) throw new HttpError(429, "rate_limit_exceeded", "Too many requests");
    if (rateBuckets.size > 10_000) for (const [entry, value] of rateBuckets) if (value.resetAt <= timestamp) rateBuckets.delete(entry);
  }

  const server = createServer(async (request, response) => {
    const requestId = request.headers["x-request-id"] || randomUUID();
    response.setHeader("x-request-id", requestId);
    setSecurityHeaders(request, response, config);
    try {
      const remoteAddress = request.socket.remoteAddress || "unknown";
      if (request.method === "OPTIONS") {
        enforceRateLimit(`preflight:${remoteAddress}`, response);
        return response.writeHead(204).end();
      }
      const url = new URL(request.url, "http://localhost");
      const { pathname } = url;
      if(request.method==='GET'&&pathname==='/') {response.writeHead(302,{location:'/app/'});return response.end();}
      if(request.method==='GET'&&pathname.startsWith('/app/')) {
        const asset=uiAsset(pathname);
        if(asset){
          enforceRateLimit(`asset:${remoteAddress}`,response);
          response.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
          return sendBytes(response,200,asset.bytes,{'content-type':asset.contentType});
        }
      }
      if(pathname.startsWith('/v1/auth/')) {
        enforceRateLimit(`browser-auth:${remoteAddress}`,response);
        if(request.method==='GET'&&pathname==='/v1/auth/config')return sendJson(response,200,{mode:config.allowInsecureDevAuth?'development':browserAuth.enabled?'oidc':'unavailable'});
        if(request.method==='GET'&&pathname==='/v1/auth/login'){
          const result=await browserAuth.begin(request);response.writeHead(302,{location:result.location,'set-cookie':result.cookies});return response.end();
        }
        if(request.method==='GET'&&pathname==='/v1/auth/callback'){
          const result=await browserAuth.callbackResult(request,url);response.writeHead(302,{location:result.location,'set-cookie':result.cookies});return response.end();
        }
        if(request.method==='GET'&&pathname==='/v1/auth/session')return sendJson(response,200,await browserAuth.status(request));
        if(request.method==='POST'&&pathname==='/v1/auth/logout'){response.setHeader('set-cookie',browserAuth.logout(request));return sendJson(response,200,{signedOut:true});}
        throw new HttpError(404,'not_found','Unknown login route');
      }
      if(request.method==='POST'&&pathname==='/v1/dev/session') {
        enforceRateLimit(`dev-login:${remoteAddress}`,response);
        return sendJson(response,200,localSession(db,config,await readJson(request)));
      }
      if (request.method === "GET" && pathname === "/health") {
        enforceRateLimit(`anonymous:${remoteAddress}`, response);
        return sendJson(response, 200, { status: "ok", service: "dossiermind-platform", version: "0.1.0" });
      }

      let principal;
      try { principal = request.headers.authorization ? await authenticate(request, config) : browserAuth.enabled ? await browserAuth.principal(request) : await authenticate(request, config); }
      catch (error) {
        if (error instanceof HttpError && error.status === 401) enforceRateLimit(`auth-failure:${remoteAddress}`, response);
        throw error;
      }
      enforceRateLimit(`principal:${principal.id}`, response);
      if (pathname === '/v1/me/consents' && request.method === 'GET') return sendJson(response,200,{data:consentService.mine(principal)});
      const consentRoute = routeMatch(pathname, '/v1/tenants/:tenantId/consents');
      if (consentRoute && request.method === 'GET') return sendJson(response, 200, {data:consentService.list(consentRoute.tenantId,principal)});
      if (consentRoute && request.method === 'POST') return sendJson(response, 201, consentService.request(consentRoute.tenantId,principal));
      const consentDecision = routeMatch(pathname, '/v1/tenants/:tenantId/consents/:consentId');
      if (consentDecision && request.method === 'PUT') return sendJson(response, 200, consentService.decide(consentDecision.tenantId,consentDecision.consentId,await readJson(request),principal));
      if(request.method==="GET" && pathname==="/v1/me/tenants") return sendJson(response,200,{data:service.listMyTenants(principal)});
      if (request.method === "GET" && pathname === "/v1/me") {
        return sendJson(response, 200, { id: principal.id, type: principal.type, role: principal.role, scopes: [...principal.scopes] });
      }

      if (request.method === "POST" && pathname === "/v1/admin/organizations") {
        requireScope(principal, "platform:admin");
        return sendJson(response, 201, service.createOrganization(await readJson(request), principal));
      }
      if (request.method === "POST" && pathname === "/v1/admin/users") {
        requireScope(principal, "platform:admin");
        return sendJson(response, 201, service.createUser(await readJson(request), principal));
      }
      if (request.method === "POST" && pathname === "/v1/admin/tenants") {
        requireScope(principal, "platform:admin");
        return sendJson(response, 201, service.createTenant(await readJson(request), principal));
      }
      if (request.method === "POST" && pathname === "/v1/admin/partner-clients") {
        requireScope(principal, "platform:admin");
        return sendJson(response, 201, service.createPartnerClient(await readJson(request), principal));
      }
      if (request.method === "POST" && pathname === "/v1/admin/retention/enforce") {
        requireScope(principal, "platform:admin");
        return sendJson(response, 200, service.enforceRetention(principal));
      }

      const calculationMemoryRoute=routeMatch(pathname,'/v1/tenants/:tenantId/brain/calculations');
      if(calculationMemoryRoute&&request.method==='GET')return sendJson(response,200,{data:new CalculationMemory(db,config).list(calculationMemoryRoute.tenantId,principal)});
      if(calculationMemoryRoute&&request.method==='POST')return sendJson(response,201,new CalculationMemory(db,config).save(calculationMemoryRoute.tenantId,await readJson(request),principal));
      const savedCalculationRoute=routeMatch(pathname,'/v1/tenants/:tenantId/brain/calculations/:calculationId');
      if(savedCalculationRoute&&request.method==='GET')return sendJson(response,200,new CalculationMemory(db,config).get(savedCalculationRoute.tenantId,savedCalculationRoute.calculationId,principal));
      const calculationRoute=routeMatch(pathname,'/v1/tenants/:tenantId/brain/calculations/bank-summary');
      if(calculationRoute&&request.method==='POST')return sendJson(response,200,bankSummary(db,config,calculationRoute.tenantId,await readJson(request),principal));
      const reportsRoute=routeMatch(pathname,'/v1/tenants/:tenantId/reports');
      if(reportsRoute&&request.method==='GET'){authorizeTenant(db,principal,reportsRoute.tenantId,'documents:read');return sendJson(response,200,{data:listReports(db,reportsRoute.tenantId)});}
      const reportRoute=routeMatch(pathname,'/v1/tenants/:tenantId/reports/:reportId');
      if(reportRoute&&request.method==='GET'){const report=downloadReport(db,config,reportRoute.tenantId,reportRoute.reportId,principal);return sendBytes(response,200,report.bytes,{'content-type':'application/pdf','content-disposition':`attachment; filename="${report.filename}"`});}
      const checklistsRoute=routeMatch(pathname,'/v1/tenants/:tenantId/brain/checklists');
      if(checklistsRoute&&request.method==='GET')return sendJson(response,200,{data:checklists.list(checklistsRoute.tenantId,principal)});
      if(checklistsRoute&&request.method==='POST')return sendJson(response,201,checklists.save(checklistsRoute.tenantId,null,await readJson(request),principal));
      const checklistRoute=routeMatch(pathname,'/v1/tenants/:tenantId/brain/checklists/:checklistId');
      if(checklistRoute&&request.method==='GET')return sendJson(response,200,{data:checklists.history(checklistRoute.tenantId,checklistRoute.checklistId,principal)});
      if(checklistRoute&&request.method==='PUT')return sendJson(response,200,checklists.save(checklistRoute.tenantId,checklistRoute.checklistId,await readJson(request),principal));
      const assertionsRoute=routeMatch(pathname,'/v1/tenants/:tenantId/brain/assertions');
      if(assertionsRoute&&request.method==='GET')return sendJson(response,200,{data:assertions.list(assertionsRoute.tenantId,principal)});
      if(assertionsRoute&&request.method==='POST')return sendJson(response,201,assertions.save(assertionsRoute.tenantId,null,await readJson(request),principal));
      const assertionRoute=routeMatch(pathname,'/v1/tenants/:tenantId/brain/assertions/:assertionId');
      if(assertionRoute&&request.method==='GET')return sendJson(response,200,{data:assertions.history(assertionRoute.tenantId,assertionRoute.assertionId,principal)});
      if(assertionRoute&&request.method==='PUT')return sendJson(response,200,assertions.save(assertionRoute.tenantId,assertionRoute.assertionId,await readJson(request),principal));
      const notesRoute=routeMatch(pathname,'/v1/tenants/:tenantId/brain/notes');
      if(notesRoute&&request.method==='GET')return sendJson(response,200,{data:notes.list(notesRoute.tenantId,principal)});
      if(notesRoute&&request.method==='POST')return sendJson(response,201,notes.save(notesRoute.tenantId,null,await readJson(request),principal));
      const noteRoute=routeMatch(pathname,'/v1/tenants/:tenantId/brain/notes/:noteId');
      if(noteRoute&&request.method==='GET')return sendJson(response,200,{data:notes.history(noteRoute.tenantId,noteRoute.noteId,principal)});
      if(noteRoute&&request.method==='PUT')return sendJson(response,200,notes.save(noteRoute.tenantId,noteRoute.noteId,await readJson(request),principal));

      let packageParams=routeMatch(pathname,'/v1/tenants/:tenantId/dev-package');
      if(request.method==='GET'&&packageParams) {
        authorizeTenant(db,principal,packageParams.tenantId,'documents:read');
        return sendJson(response,200,localPackage(db,config,packageParams.tenantId));
      }
      packageParams=routeMatch(pathname,'/v1/tenants/:tenantId/dev-package/:filename');
      if(request.method==='GET'&&packageParams) {
        authorizeTenant(db,principal,packageParams.tenantId,'documents:read');
        const file=localPackage(db,config,packageParams.tenantId,packageParams.filename);
        return sendBytes(response,200,file.bytes,{'content-type':file.contentType});
      }
      let params = routeMatch(pathname, "/v1/admin/partner-clients/:partnerClientId/tenants/:tenantId");
      if (request.method === "PUT" && params) {
        requireScope(principal, "platform:admin");
        return sendJson(response, 200, service.grantPartnerTenant(params.partnerClientId, params.tenantId, principal));
      }

      params = routeMatch(pathname, "/v1/admin/tenants/:tenantId/memberships");
      if (request.method === "PUT" && params) {
        requireScope(principal, "platform:admin");
        return sendJson(response, 200, service.addMembership(params.tenantId, await readJson(request), principal));
      }

      params=routeMatch(pathname,"/v1/admin/tenants/:tenantId/memberships/:userId");
      if(params && request.method==="DELETE") {
        requireScope(principal,"platform:admin");
        return sendJson(response,200,service.revokeMembership(params.tenantId,params.userId,principal));
      }
      params=routeMatch(pathname,"/v1/tenants/:tenantId/ai/status");
      if(params&&request.method==='GET')return sendJson(response,200,{data:aiStatus(db,advisor.gateway,params.tenantId,principal)});
      params=routeMatch(pathname,"/v1/tenants/:tenantId/brain/memory");
      if(params&&request.method==='GET')return sendJson(response,200,{data:memory.list(params.tenantId,principal),readiness:memory.gateway.readiness()});
      if(params&&request.method==='POST')return sendJson(response,202,memory.create(params.tenantId,await readJson(request,2048),principal));
      params=routeMatch(pathname,"/v1/tenants/:tenantId/brain/memory/:memoryId/page");
      if(params&&request.method==='GET')return sendBytes(response,200,await memory.preview(params.tenantId,params.memoryId,principal),{'content-type':'image/png'});
      params=routeMatch(pathname,"/v1/tenants/:tenantId/brain/memory/:memoryId/review");
      if(params&&request.method==='PUT')return sendJson(response,200,memory.review(params.tenantId,params.memoryId,await readJson(request,4096),principal));
      params=routeMatch(pathname,"/v1/tenants/:tenantId/brain/memory/:memoryId");
      if(params&&request.method==='GET')return sendJson(response,200,memory.get(params.tenantId,params.memoryId,principal));
      if(params&&request.method==='DELETE')return sendJson(response,200,memory.cancel(params.tenantId,params.memoryId,principal));
      params=routeMatch(pathname,"/v1/tenants/:tenantId/advisor/contributions");
      if(params&&request.method==='GET')return sendJson(response,200,{data:contributionOptions(db,config,params.tenantId,principal)});
      params=routeMatch(pathname,"/v1/tenants/:tenantId/advisor/requests/:advisorId/review");
      if(params&&request.method==='PUT')return sendJson(response,200,advisor.review(params.tenantId,params.advisorId,await readJson(request,4096),principal));
      params=routeMatch(pathname,"/v1/tenants/:tenantId/advisor/requests");
      if(params&&request.method==='GET')return sendJson(response,200,{data:advisor.list(params.tenantId,principal),readiness:advisor.gateway.readiness()});
      if(params&&request.method==='POST')return sendJson(response,202,advisor.create(params.tenantId,await readJson(request,8192),principal));
      params=routeMatch(pathname,"/v1/tenants/:tenantId/advisor/requests/:advisorId");
      if(params&&request.method==='GET')return sendJson(response,200,advisor.get(params.tenantId,params.advisorId,principal));
      if(params&&request.method==='DELETE')return sendJson(response,200,advisor.cancel(params.tenantId,params.advisorId,principal));
      params=routeMatch(pathname,"/v1/tenants/:tenantId/advisor/evidence");
      if(params&&request.method==='POST') {
        authorizeTenant(db,principal,params.tenantId,'documents:read');
        const input=await readJson(request,4096);
        assert(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(key=>key==='question'),400,'validation_error','Only question is accepted');
        const prepared=prepareAdvisorEvidence(db,config,params.tenantId,principal,input.question);
        appendAudit(db,config.auditKey,{tenantId:params.tenantId,actorId:principal.id,actorType:principal.type,action:'advisor.evidence_retrieved',targetType:'tenant',targetId:params.tenantId,metadata:{aiExecuted:false,passages:prepared.evidence.length,method:prepared.retrieval.method}});
        return sendJson(response,200,{...prepared,aiExecuted:false,stage:'source-preview',answer:null});
      }
      params=routeMatch(pathname,"/v1/tenants/:tenantId/brain/search");
      if(params&&request.method==='GET') {
        authorizeTenant(db,principal,params.tenantId,'documents:read');
        return sendJson(response,200,searchFragments(db,config,params.tenantId,url.searchParams.get('q')));
      }
      params=routeMatch(pathname,"/v1/tenants/:tenantId/brain/graph");
      if(params&&request.method==='GET') {
        authorizeTenant(db,principal,params.tenantId,'documents:read');
        return sendJson(response,200,sourceGraph(db,params.tenantId,config));
      }
      params=routeMatch(pathname,"/v1/tenants/:tenantId/documents/:documentId/fragments");
      if(params && request.method==="GET") {
        authorizeTenant(db,principal,params.tenantId,"documents:read");
        return sendJson(response,200,service.getFragments(params.tenantId,params.documentId));
      }
      params = routeMatch(pathname, "/v1/tenants/:tenantId");
      if (request.method === "GET" && params) {
        authorizeTenant(db, principal, params.tenantId, "tenant:read");
        return sendJson(response, 200, service.getTenant(params.tenantId));
      }

      params = routeMatch(pathname, "/v1/tenants/:tenantId/documents");
      if (params && request.method === "GET") {
        authorizeTenant(db, principal, params.tenantId, "documents:read");
        return sendJson(response, 200, { data: service.listDocuments(params.tenantId) });
      }
      if (params && request.method === "POST") {
        authorizeTenant(db, principal, params.tenantId, "documents:write");
        const bytes = await readBody(request, config.maxUploadBytes);
        let filename = "";
        try { filename = request.headers["x-filename"] ? decodeURIComponent(String(request.headers["x-filename"])) : ""; }
        catch { throw new HttpError(400, "invalid_filename", "x-filename contains invalid encoding"); }
        const document = service.uploadDocument(params.tenantId, {
          filename,
          mimeType: request.headers["content-type"] ?? "application/octet-stream",
          bytes,
          idempotencyKey: request.headers["idempotency-key"] ? String(request.headers["idempotency-key"]) : null,
        }, principal);
        return sendJson(response, 201, document);
      }

      params = routeMatch(pathname, "/v1/tenants/:tenantId/documents/:documentId/deletion-manifest");
      if(params&&request.method==='GET'){
        authorizeTenant(db,principal,params.tenantId,'documents:delete');
        return sendJson(response,200,service.deletionManifest(params.tenantId,params.documentId));
      }
      params = routeMatch(pathname, "/v1/tenants/:tenantId/documents/:documentId");
      if (params && request.method === "GET") {
        authorizeTenant(db, principal, params.tenantId, "documents:read");
        const result = service.downloadDocument(params.tenantId, params.documentId, principal);
        return sendBytes(response, 200, result.bytes, {
          "content-type": result.metadata.mimeType,
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.metadata.filename)}`,
          "x-document-sha256": result.metadata.sha256,
        });
      }
      if (params && request.method === "DELETE") {
        authorizeTenant(db, principal, params.tenantId, "documents:delete");
        const expected=request.headers['x-deletion-manifest'];
        assert(typeof expected==='string'&&/^[a-f0-9]{64}$/.test(expected),400,'deletion_review_required','Review the deletion manifest before confirming');
        return sendJson(response, 200, service.deleteDocument(params.tenantId, params.documentId, principal,expected));
      }

      params = routeMatch(pathname, "/v1/tenants/:tenantId/jobs");
      if (params && request.method === "POST") {
        authorizeTenant(db, principal, params.tenantId, "jobs:write");
        return sendJson(response, 202, service.createJob(params.tenantId, await readJson(request), principal));
      }
      params = routeMatch(pathname, "/v1/tenants/:tenantId/jobs/:jobId");
      if (params && request.method === "GET") {
        authorizeTenant(db, principal, params.tenantId, "jobs:read");
        return sendJson(response, 200, service.getJob(params.tenantId, params.jobId));
      }

      params = routeMatch(pathname, "/v1/tenants/:tenantId/audit");
      if (params && request.method === "GET") {
        authorizeTenant(db, principal, params.tenantId, "audit:read");
        const limit = Number(url.searchParams.get("limit") ?? 100);
        assert(Number.isInteger(limit) && limit >= 1 && limit <= 1000, 400, "validation_error", "limit must be an integer between 1 and 1000");
        return sendJson(response, 200, service.audit(params.tenantId, limit));
      }

      params = routeMatch(pathname, "/v1/tenants/:tenantId/privacy/export");
      if (params && request.method === "POST") {
        authorizeTenant(db, principal, params.tenantId, "privacy:export");
        return sendJson(response, 200, service.exportTenant(params.tenantId, principal));
      }
      params = routeMatch(pathname, "/v1/tenants/:tenantId/privacy/erase");
      if (params && request.method === "POST") {
        authorizeTenant(db, principal, params.tenantId, "privacy:erase");
        return sendJson(response, 200, service.eraseTenant(params.tenantId, principal));
      }
      params = routeMatch(pathname, "/v1/tenants/:tenantId/privacy/retention");
      if (params && request.method === "PUT") {
        authorizeTenant(db, principal, params.tenantId, "privacy:manage");
        return sendJson(response, 200, service.setRetention(params.tenantId, await readJson(request), principal));
      }
      params = routeMatch(pathname, "/v1/tenants/:tenantId/privacy/legal-holds");
      if (params && request.method === "POST") {
        authorizeTenant(db, principal, params.tenantId, "privacy:legal_hold");
        return sendJson(response, 201, service.addLegalHold(params.tenantId, await readJson(request), principal));
      }

      params = routeMatch(pathname, "/v1/tenants/:tenantId/webhooks");
      if (params && request.method === "POST") {
        authorizeTenant(db, principal, params.tenantId, "webhooks:manage");
        return sendJson(response, 201, service.registerWebhook(params.tenantId, await readJson(request), principal));
      }

      params = routeMatch(pathname, "/v1/tenants/:tenantId/integrations/mappings");
      if (params && request.method === "PUT") {
        authorizeTenant(db, principal, params.tenantId, "integrations:write");
        return sendJson(response, 200, service.upsertExternalMapping(params.tenantId, await readJson(request), principal));
      }
      if (params && request.method === "GET") {
        authorizeTenant(db, principal, params.tenantId, "integrations:read");
        return sendJson(response, 200, service.getExternalMapping(params.tenantId, {
          partnerClientId: url.searchParams.get("partnerClientId"),
          resourceType: url.searchParams.get("resourceType"),
          externalId: url.searchParams.get("externalId"),
        }));
      }

      throw new HttpError(404, "not_found", "Endpoint not found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : "internal_error";
      const message = error instanceof HttpError ? error.message : "Internal server error";
      if (status >= 500) console.error({ requestId, error });
      return sendJson(response, status, { error: { code, message, details: error.details, requestId } });
    }
  });

  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = config.headersTimeoutMs;
  server.maxHeadersCount = 100;

  return { server, db, service, advisor, memory, deletionRecovery };
}
