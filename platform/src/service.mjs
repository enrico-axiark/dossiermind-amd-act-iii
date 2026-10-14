import {DocumentMemory,purgeDocumentMemory} from './document-memory.mjs';
import {documentDeletionManifest} from './deletion-manifest.mjs';
import {AdvisorJobs,purgeDocumentAdvisor} from './advisor-jobs.mjs';
import {AssertionService,purgeDocumentAssertions} from './assertions.mjs';
import {ChecklistService,purgeDocumentChecklists} from './checklists.mjs';
import {CalculationMemory,purgeDocumentCalculations} from "./calculation-memory.mjs";
import {enqueueReport,purgeDocumentReports,listReports} from "./reports.mjs";
import {NoteService,purgeDocumentNotes} from "./notes.mjs";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { isIP } from "node:net";
import { appendAudit, listAudit, verifyAuditChain } from "./audit.mjs";
import { encryptBuffer, hmacHex, sha256 } from "./crypto.mjs";
import { assert, HttpError } from "./errors.mjs";
import { deleteEncryptedObject, readEncryptedObject, storeEncryptedObject } from "./storage.mjs";
import { readExtraction } from "./ingestion.mjs";
import { authorizeTenant } from "./auth.mjs";
import { transaction } from "./db.mjs";

const now = () => new Date().toISOString();

function text(value, name, max = 255) {
  assert(typeof value === "string" && value.trim().length > 0 && value.length <= max, 400, "validation_error", `${name} must contain 1-${max} characters`);
  return value.trim();
}

function validateUpload(filename, mimeType, bytes) {
  const safeName = text(filename, "filename", 255);
  assert(!/[\\/\0]/.test(safeName), 400, "validation_error", "filename must not contain path separators");
  const type = String(mimeType || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
  const executable = (bytes[0] === 0x4d && bytes[1] === 0x5a) || bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  assert(!executable, 415, "unsafe_upload", "Executable files are not accepted");
  assert(!bytes.includes(Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")), 415, "malware_detected", "Known malware test signature detected");
  const matches = type === "application/pdf" ? bytes.subarray(0, 5).toString() === "%PDF-"
    : type === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : type === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : true;
  assert(matches, 415, "mime_mismatch", "File content does not match the declared media type");
  return { filename: safeName, mimeType: type };
}

function validateWebhookUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new HttpError(400, "validation_error", "Webhook URL is invalid"); }
  assert(url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443"), 400, "validation_error", "Webhook URL must use HTTPS on the standard port without credentials");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const blocked = isBlockedWebhookHost(host);
  assert(!blocked, 400, "webhook_target_blocked", "Webhook target is local or private");
  return url.toString();
}

function isBlockedWebhookHost(host) {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const version = isIP(host);
  if (version === 4) return isNonPublicIpv4(host);
  if (version === 6) {
    const words = expandIpv6(host);
    if (!words) return true;
    const ipv4Mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
    if (ipv4Mapped) return true;
    const globalUnicast = (words[0] & 0xe000) === 0x2000;
    const documentation = words[0] === 0x2001 && words[1] === 0x0db8;
    return !globalUnicast || documentation;
  }
  return false;
}

function isNonPublicIpv4(host) {
  const [a, b, c] = host.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

function expandIpv6(host) {
  if (!/^[0-9a-f:]+$/.test(host) || (host.match(/::/g) ?? []).length > 1) return null;
  const [left, right = ""] = host.split("::");
  const leftWords = left ? left.split(":") : [];
  const rightWords = right ? right.split(":") : [];
  if (!host.includes("::") && leftWords.length !== 8) return null;
  const missing = 8 - leftWords.length - rightWords.length;
  if (missing < (host.includes("::") ? 1 : 0)) return null;
  const values = [...leftWords, ...Array(missing).fill("0"), ...rightWords].map((part) => Number.parseInt(part, 16));
  return values.length === 8 && values.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff) ? values : null;
}

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  return JSON.parse(value);
}

function documentDto(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    filename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

export class PlatformService {
  constructor(db, config) {
    this.db = db;
    this.config = config;
    mkdirSync(config.storageRoot, { recursive: true, mode: 0o700 });
  }

  createOrganization({ name, type = "studio" }, principal) {
    assert(name, 400, "validation_error", "Organization name is required");
    assert(["studio", "pmi", "partner", "platform"].includes(type), 400, "validation_error", "Organization type is invalid");
    const organization = { id: randomUUID(), name, type, createdAt: now() };
    this.db.prepare("INSERT INTO organizations (id, name, type, created_at) VALUES (?, ?, ?, ?)")
      .run(organization.id, organization.name, organization.type, organization.createdAt);
    this.auditPlatform(principal, "organization.created", "organization", organization.id);
    return organization;
  }

  createUser({ id, email, displayName }, principal) {
    assert(id && email && displayName, 400, "validation_error", "id, email and displayName are required");
    const user = { id, email: email.toLowerCase(), displayName, createdAt: now() };
    this.db.prepare("INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)")
      .run(user.id, user.email, user.displayName, user.createdAt);
    this.auditPlatform(principal, "user.created", "user", user.id);
    return user;
  }

  createTenant({ organizationId, externalId = null, name, region = "eu", retentionDays = 365 }, principal) {
    assert(organizationId && name, 400, "validation_error", "organizationId and name are required");
    assert(this.db.prepare("SELECT 1 FROM organizations WHERE id = ?").get(organizationId), 404, "organization_not_found", "Organization not found");
    assert(Number.isInteger(retentionDays) && retentionDays >= 1, 400, "validation_error", "retentionDays must be a positive integer");
    const tenant = { id: randomUUID(), organizationId, externalId, name, region, retentionDays, status: "active", createdAt: now() };
    this.db.prepare(`INSERT INTO tenants
      (id, organization_id, external_id, name, status, region, retention_days, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(tenant.id, tenant.organizationId, tenant.externalId, tenant.name, tenant.status, tenant.region, tenant.retentionDays, tenant.createdAt);
    appendAudit(this.db, this.config.auditKey, {
      tenantId: tenant.id, actorId: principal.id, actorType: principal.type,
      action: "tenant.created", targetType: "tenant", targetId: tenant.id,
      metadata: { region, retentionDays },
    });
    return tenant;
  }

  addMembership(tenantId, { userId, role, scopes }, principal) {
    assert(userId && role && Array.isArray(scopes), 400, "validation_error", "userId, role and scopes are required");
    assert(this.db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId), 404, "user_not_found", "User not found");
    this.requireActiveTenant(tenantId);
    this.db.prepare(`INSERT INTO memberships (tenant_id, user_id, role, scopes_json, created_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id, user_id) DO UPDATE SET role=excluded.role, scopes_json=excluded.scopes_json`)
      .run(tenantId, userId, role, JSON.stringify(scopes), now());
    this.db.prepare("UPDATE tenants SET access_epoch=access_epoch+1 WHERE id=?").run(tenantId);
    appendAudit(this.db, this.config.auditKey, {
      tenantId, actorId: principal.id, actorType: principal.type,
      action: "membership.upserted", targetType: "user", targetId: userId,
      metadata: { role, scopes },
    });
    return { tenantId, userId, role, scopes };
  }

  createPartnerClient({ organizationId, name }, principal) {
    assert(organizationId && name, 400, "validation_error", "organizationId and name are required");
    const organization = this.db.prepare("SELECT type FROM organizations WHERE id = ?").get(organizationId);
    assert(organization, 404, "organization_not_found", "Organization not found");
    assert(organization.type === "partner", 409, "organization_type_invalid", "Partner client requires a partner organization");
    const partner = { id: randomUUID(), organizationId, name, status: "active", createdAt: now() };
    this.db.prepare("INSERT INTO partner_clients (id, organization_id, name, status, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(partner.id, partner.organizationId, partner.name, partner.status, partner.createdAt);
    this.auditPlatform(principal, "partner_client.created", "partner_client", partner.id);
    return partner;
  }

  grantPartnerTenant(partnerClientId, tenantId, principal) {
    this.requireActiveTenant(tenantId);
    assert(this.db.prepare("SELECT 1 FROM partner_clients WHERE id = ? AND status = 'active'").get(partnerClientId), 404, "partner_not_found", "Partner client not found");
    this.db.prepare(`INSERT INTO partner_tenant_grants (partner_client_id, tenant_id, created_by, created_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(partner_client_id, tenant_id) DO NOTHING`).run(partnerClientId, tenantId, principal.id, now());
    appendAudit(this.db, this.config.auditKey, { tenantId, actorId: principal.id, actorType: principal.type, action: "integration.partner.granted", targetType: "partner_client", targetId: partnerClientId, metadata: {} });
    return { partnerClientId, tenantId };
  }

  upsertExternalMapping(tenantId, { partnerClientId, resourceType, externalId, internalId }, principal) {
    this.requireActiveTenant(tenantId);
    assert(partnerClientId && resourceType && externalId && internalId, 400, "validation_error", "partnerClientId, resourceType, externalId and internalId are required");
    assert(this.db.prepare("SELECT 1 FROM partner_tenant_grants WHERE partner_client_id = ? AND tenant_id = ?").get(partnerClientId, tenantId), 403, "partner_tenant_denied", "Partner client is not authorized for this tenant");
    const createdAt = now();
    this.db.prepare(`INSERT INTO external_mappings
      (partner_client_id, tenant_id, resource_type, external_id, internal_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(partner_client_id, tenant_id, resource_type, external_id)
      DO UPDATE SET internal_id=excluded.internal_id`)
      .run(partnerClientId, tenantId, resourceType, externalId, internalId, createdAt);
    appendAudit(this.db, this.config.auditKey, {
      tenantId, actorId: principal.id, actorType: principal.type,
      action: "integration.mapping.upserted", targetType: resourceType, targetId: internalId,
      metadata: { partnerClientId, externalId },
    });
    return { partnerClientId, tenantId, resourceType, externalId, internalId, createdAt };
  }

  getExternalMapping(tenantId, { partnerClientId, resourceType, externalId }) {
    const row = this.db.prepare(`SELECT partner_client_id, tenant_id, resource_type, external_id, internal_id, created_at
      FROM external_mappings WHERE partner_client_id = ? AND tenant_id = ? AND resource_type = ? AND external_id = ?`)
      .get(partnerClientId, tenantId, resourceType, externalId);
    assert(row, 404, "mapping_not_found", "External mapping not found");
    return { partnerClientId: row.partner_client_id, tenantId: row.tenant_id, resourceType: row.resource_type, externalId: row.external_id, internalId: row.internal_id, createdAt: row.created_at };
  }

  getTenant(tenantId) {
    const row = this.db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
    assert(row, 404, "tenant_not_found", "Tenant not found");
    return {
      id: row.id, organizationId: row.organization_id, externalId: row.external_id,
      name: row.name, status: row.status, region: row.region,
      retentionDays: row.retention_days, createdAt: row.created_at,
    };
  }

  requireActiveTenant(tenantId) {
    const tenant = this.getTenant(tenantId);
    assert(tenant.status === "active", 409, "tenant_not_active", `Tenant status is ${tenant.status}`);
    return tenant;
  }

  uploadDocument(tenantId, { filename, mimeType, bytes, idempotencyKey }, principal) {
    this.requireActiveTenant(tenantId);
    assert(filename && bytes?.length, 400, "validation_error", "Filename and non-empty document body are required");
    assert(bytes.length <= this.config.maxUploadBytes, 413, "upload_too_large", "Document exceeds upload limit");
    const validated = validateUpload(filename, mimeType, bytes);
    filename = validated.filename; mimeType = validated.mimeType;
    const requestHash = sha256(Buffer.concat([Buffer.from(filename), bytes]));
    if (idempotencyKey) {
      const previous = this.db.prepare("SELECT request_hash, response_json FROM idempotency_keys WHERE tenant_id = ? AND key = ?").get(tenantId, idempotencyKey);
      if (previous) {
        assert(previous.request_hash === requestHash, 409, "idempotency_conflict", "Idempotency key was used for a different request");
        return parseJson(previous.response_json);
      }
    }
    const digest = sha256(bytes);
    const existing = this.db.prepare("SELECT * FROM documents WHERE tenant_id = ? AND sha256 = ? AND deleted_at IS NULL").get(tenantId, digest);
    if (existing) return documentDto(existing);
    const id = randomUUID();
    const createdAt = now();
    const storedPath = storeEncryptedObject(this.db, this.config, tenantId, id, bytes);
    let document;
    try { document = transaction(this.db, () => {
      this.db.prepare(`INSERT INTO documents
        (id, tenant_id, original_filename, mime_type, size_bytes, sha256, stored_path, status, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'stored', ?, ?)`)
        .run(id, tenantId, filename, mimeType || "application/octet-stream", bytes.length, digest, storedPath, principal.id, createdAt);
      appendAudit(this.db, this.config.auditKey, {
        tenantId, actorId: principal.id, actorType: principal.type,
        action: "document.stored", targetType: "document", targetId: id,
        metadata: { filename, mimeType: mimeType || "application/octet-stream", sizeBytes: bytes.length, sha256: digest },
      });
      const dto = documentDto(this.db.prepare("SELECT * FROM documents WHERE id = ?").get(id));
      if (idempotencyKey) this.db.prepare("INSERT INTO idempotency_keys (tenant_id, key, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(tenantId, idempotencyKey, requestHash, JSON.stringify(dto), createdAt);
      return dto;
    }); } catch (error) { deleteEncryptedObject(storedPath, this.config, tenantId); throw error; }
    return document;
  }

  listDocuments(tenantId) {
    this.requireActiveTenant(tenantId);
    return this.db.prepare(`SELECT d.*,e.status AS extraction_status,e.warnings_json FROM documents d
      LEFT JOIN document_extractions e ON e.document_id=d.id WHERE d.tenant_id=? AND d.deleted_at IS NULL
      AND d.status='stored' ORDER BY d.created_at DESC`).all(tenantId).map(row=>({...documentDto(row),extractionStatus:row.extraction_status||'not_processed',warningCount:parseJson(row.warnings_json,[]).length}));
  }

  downloadDocument(tenantId, documentId, principal) {
    this.requireActiveTenant(tenantId);
    const row = this.db.prepare("SELECT * FROM documents WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL AND status = 'stored'").get(documentId, tenantId);
    assert(row, 404, "document_not_found", "Document not found");
    const bytes = readEncryptedObject(this.db, this.config, tenantId, row.id, row.stored_path);
    appendAudit(this.db, this.config.auditKey, {
      tenantId, actorId: principal.id, actorType: principal.type,
      action: "document.read", targetType: "document", targetId: documentId,
      metadata: { sha256: row.sha256 },
    });
    return { metadata: documentDto(row), bytes };
  }

  deletionManifest(tenantId,documentId) {
    this.requireActiveTenant(tenantId);
    return documentDeletionManifest(this.db,tenantId,documentId);
  }

  resumeDocumentDeletions() {
    const pending=this.db.prepare("SELECT d.id,d.tenant_id FROM documents d JOIN tenants t ON t.id=d.tenant_id WHERE d.status='deleting' AND d.deleted_at IS NULL AND t.status='active'").all();
    const summary={pending:pending.length,completed:0,blockedByHold:0,failed:0};
    const principal={id:'deletion-recovery',type:'system',scopes:new Set(['platform:admin'])};
    for(const row of pending){
      try{this.deleteDocument(row.tenant_id,row.id,principal);summary.completed++;}
      catch(error){if(error.code==='legal_hold_active')summary.blockedByHold++;else summary.failed++;}
    }
    return summary;
  }

  deleteDocument(tenantId, documentId, principal, expectedManifest=null) {
    this.requireActiveTenant(tenantId);
    const row = this.db.prepare("SELECT * FROM documents WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL").get(documentId, tenantId);
    assert(row, 404, "document_not_found", "Document not found");
    const hold = this.db.prepare("SELECT id, reason FROM legal_holds WHERE tenant_id = ? AND active = 1 LIMIT 1").get(tenantId);
    if (hold) throw new HttpError(409, "legal_hold_active", "Document cannot be deleted while a legal hold is active", { holdId: hold.id });
    const manifest=this.deletionManifest(tenantId,documentId);
    if(expectedManifest!==null)assert(expectedManifest===manifest.manifestSha256,409,'deletion_manifest_changed','Dependencies changed; review the deletion again');
    if(row.status!=='deleting')transaction(this.db,()=>{
      appendAudit(this.db,this.config.auditKey,{tenantId,actorId:principal.id,actorType:principal.type,action:'document.deletion.started',targetType:'document',targetId:documentId,metadata:{manifestSha256:manifest.manifestSha256}});
      this.db.prepare("UPDATE documents SET status = 'deleting' WHERE id = ?").run(documentId);
    });
    // Remove PDF bodies before dependency cascades erase their provenance links.
    for(const id of manifest.affected.reports)this.db.prepare('DELETE FROM generated_reports WHERE tenant_id=? AND id=?').run(tenantId,id);
    purgeDocumentChecklists(this.db,tenantId,documentId);
    purgeDocumentNotes(this.db,tenantId,documentId);
    purgeDocumentAdvisor(this.db,tenantId,documentId);
    purgeDocumentMemory(this.db,tenantId,documentId);
    purgeDocumentAssertions(this.db,tenantId,documentId);
    purgeDocumentCalculations(this.db,tenantId,documentId);
    purgeDocumentReports(this.db,tenantId,documentId);
    const extraction=this.db.prepare('SELECT stored_path FROM document_extractions WHERE document_id=?').get(documentId);
    if(extraction)deleteEncryptedObject(extraction.stored_path,this.config,tenantId);
    this.db.prepare('DELETE FROM document_extractions WHERE document_id=?').run(documentId);
    this.db.prepare('DELETE FROM idempotency_keys WHERE tenant_id=?').run(tenantId);
    deleteEncryptedObject(row.stored_path, this.config, tenantId);
    const deletedAt = now();
    this.db.prepare("UPDATE documents SET deleted_at = ?, status = 'deleted', stored_path = '' WHERE id = ?").run(deletedAt, documentId);
    appendAudit(this.db, this.config.auditKey, {
      tenantId, actorId: principal.id, actorType: principal.type,
      action: "document.deleted", targetType: "document", targetId: documentId,
      metadata: { sha256: row.sha256, manifestSha256:manifest.manifestSha256 },
    });
    return { id: documentId, deletedAt, manifestSha256:manifest.manifestSha256, removed:manifest.affected };
  }

  revokeMembership(tenantId,userId,principal) {
    this.requireActiveTenant(tenantId);
    transaction(this.db,()=>{
      this.db.prepare("DELETE FROM memberships WHERE tenant_id=? AND user_id=?").run(tenantId,userId);
      this.db.prepare("UPDATE tenants SET access_epoch=access_epoch+1 WHERE id=?").run(tenantId);
      appendAudit(this.db,this.config.auditKey,{tenantId,actorId:principal.id,actorType:principal.type,action:"membership.revoked",targetType:"user",targetId:userId});
    });
    return {tenantId,userId,revoked:true};
  }

  listMyTenants(principal) {
    if(principal.scopes.has("platform:admin"))return this.db.prepare("SELECT id,name,status FROM tenants WHERE status='active'").all();
    return this.db.prepare("SELECT t.id,t.name,t.status,m.role,m.scopes_json FROM tenants t JOIN memberships m ON t.id=m.tenant_id JOIN users u ON u.id=m.user_id WHERE m.user_id=? AND t.status='active' AND u.status='active'").all(principal.id).map(({scopes_json,...tenant})=>({...tenant,scopes:JSON.parse(scopes_json)}));
  }

  createJob(tenantId, { type, input = {} }, principal) {
    const tenant=this.requireActiveTenant(tenantId);
    if(type==='report')return this.getJob(tenantId,enqueueReport(this.db,this.config,tenantId,input,principal));
    assert(type==='ingestion',409,'job_type_not_implemented','Only deterministic ingestion is available at this stage');
    authorizeTenant(this.db,principal,tenantId,'documents:read');
    assert(Array.isArray(input.documentIds)&&input.documentIds.length>=1&&input.documentIds.length<=50,400,'validation_error','Select 1 to 50 documents');
    const ids=[...new Set(input.documentIds)];
    const sources=ids.map(id=>{
      assert(typeof id==='string',400,'validation_error','Document IDs must be strings');
      const row=this.db.prepare("SELECT id,sha256 FROM documents WHERE tenant_id=? AND id=? AND deleted_at IS NULL AND status='stored'").get(tenantId,id);
      assert(row,404,'document_not_found','A selected document is not available');return row;
    });
    const jobKey=sha256(Buffer.from(JSON.stringify({type,sources:sources.sort((a,b)=>a.id.localeCompare(b.id)),parser:'act-iii-parser-0.1.2',actor:principal.id,epoch:this.db.prepare('SELECT access_epoch FROM tenants WHERE id=?').get(tenantId).access_epoch})));
    const previous=this.db.prepare("SELECT id FROM jobs WHERE tenant_id=? AND job_key=? AND status IN ('queued','running','completed')").get(tenantId,jobKey);
    if(previous)return this.getJob(tenantId,previous.id);
    // Permit a fresh attempt after a final failure, without reusing failed authority.
    this.db.prepare('UPDATE jobs SET job_key=NULL WHERE tenant_id=? AND job_key=?').run(tenantId,jobKey);
    const id=randomUUID(),createdAt=now();
    this.db.prepare("INSERT INTO jobs (id,tenant_id,type,status,input_json,created_by,created_at,access_epoch,authority,job_key) VALUES (?,?,?,'queued',?,?,?,?,?,?)")
      .run(id,tenantId,type,JSON.stringify({documentIds:ids}),principal.id,createdAt,this.db.prepare('SELECT access_epoch FROM tenants WHERE id=?').get(tenantId).access_epoch,principal.scopes.has('platform:admin')?'platform_admin':'membership',jobKey);
    appendAudit(this.db,this.config.auditKey,{tenantId,actorId:principal.id,actorType:principal.type,action:'job.queued',targetType:'job',targetId:id,metadata:{type,documentCount:ids.length}});
    return this.getJob(tenantId,id);
  }

  getJob(tenantId, jobId) {
    this.requireActiveTenant(tenantId);
    const row=this.db.prepare("SELECT * FROM jobs WHERE tenant_id=? AND id=?").get(tenantId,jobId);
    assert(row,404,'job_not_found','Job not found');
    return {id:row.id,tenantId:row.tenant_id,type:row.type,status:row.status,input:parseJson(row.input_json,{}),output:parseJson(row.output_json),progress:parseJson(row.progress_json),errorCode:row.error_code,attempts:row.attempts,createdAt:row.created_at,completedAt:row.completed_at};
  }

  getFragments(tenantId,documentId) {
    this.requireActiveTenant(tenantId);
    assert(this.db.prepare("SELECT 1 FROM documents WHERE id=? AND tenant_id=? AND deleted_at IS NULL AND status='stored'").get(documentId,tenantId),404,'document_not_found','Document not available');
    return readExtraction(this.db,this.config,tenantId,documentId)??{documentId,status:'not_processed',fragments:[],warnings:[]};
  }

  exportTenant(tenantId, principal) {
    const tenant = this.getTenant(tenantId);
    const requestId = randomUUID();
    const createdAt = now();
    this.db.prepare("INSERT INTO privacy_requests (id, tenant_id, request_type, status, requested_by, created_at) VALUES (?, ?, 'export', 'completed', ?, ?)")
      .run(requestId, tenantId, principal.id, createdAt);
    const payload = {
      schemaVersion: "1.0",
      exportedAt: createdAt,
      tenant,
      documents: this.db.prepare("SELECT * FROM documents WHERE tenant_id = ? AND deleted_at IS NULL").all(tenantId).map(documentDto),
      calculations: new CalculationMemory(this.db,this.config).all(tenantId),
      reports: listReports(this.db,tenantId),
      assertions: new AssertionService(this.db,this.config).current(tenantId),
      assertionRevisions: new AssertionService(this.db,this.config).exportRevisions(tenantId),
      documentMemory: new DocumentMemory(this.db,this.config).export(tenantId),
      advisorHistory: new AdvisorJobs(this.db,this.config).export(tenantId),
      notes: new NoteService(this.db,this.config).exportLatest(tenantId),
      checklists: new ChecklistService(this.db,this.config).current(tenantId),
      checklistRevisions: new ChecklistService(this.db,this.config).exportRevisions(tenantId),
      noteRevisions: new NoteService(this.db,this.config).exportRevisions(tenantId),
      consents: this.db.prepare("SELECT id,user_id,status,scopes_json,requested_at,decided_at FROM consents WHERE tenant_id=?").all(tenantId),
      memberships: this.db.prepare("SELECT user_id, role, scopes_json, created_at FROM memberships WHERE tenant_id = ?").all(tenantId).map((row) => ({ userId: row.user_id, role: row.role, scopes: parseJson(row.scopes_json, []), createdAt: row.created_at })),
      audit: listAudit(this.db, tenantId, 10_000),
    };
    const result = { requestId, manifestSha256: sha256(Buffer.from(JSON.stringify(payload))), payload };
    this.db.prepare("UPDATE privacy_requests SET result_json = ?, completed_at = ? WHERE id = ?").run(JSON.stringify({ manifestSha256: result.manifestSha256 }), createdAt, requestId);
    appendAudit(this.db, this.config.auditKey, { tenantId, actorId: principal.id, actorType: principal.type, action: "privacy.exported", targetType: "privacy_request", targetId: requestId, metadata: { manifestSha256: result.manifestSha256 } });
    return result;
  }

  eraseTenant(tenantId, principal) {
    this.requireActiveTenant(tenantId);
    const hold = this.db.prepare("SELECT id, reason FROM legal_holds WHERE tenant_id = ? AND active = 1 LIMIT 1").get(tenantId);
    if (hold) throw new HttpError(409, "legal_hold_active", "Tenant cannot be erased while a legal hold is active", { holdId: hold.id, reason: hold.reason });
    const requestId = randomUUID();
    const createdAt = now();
    const derivatives=this.db.prepare("SELECT stored_path FROM document_extractions WHERE tenant_id=?").all(tenantId);
    const docs = this.db.prepare("SELECT stored_path FROM documents WHERE tenant_id = ? AND deleted_at IS NULL").all(tenantId);
    this.db.prepare("UPDATE tenants SET status = 'erasing' WHERE id = ?").run(tenantId);
    for (const row of [...docs,...derivatives]) deleteEncryptedObject(row.stored_path, this.config, tenantId);
    const summary = { documentsDeleted: docs.length, erasedAt: createdAt };
    const resultHash = sha256(Buffer.from(JSON.stringify(summary)));
    transaction(this.db, () => {
      this.db.prepare("DELETE FROM privacy_requests WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM legal_holds WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM partner_tenant_grants WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM webhook_endpoints WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM external_mappings WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM jobs WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM advisor_jobs WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM memory_requests WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM calculation_memories WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM generated_reports WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM report_series WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM dossier_checklists WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM knowledge_assertions WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM source_notes WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM documents WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM consents WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM memberships WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM idempotency_keys WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM tenant_keys WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("DELETE FROM audit_events WHERE tenant_id = ?").run(tenantId);
      this.db.prepare("UPDATE tenants SET name = 'Erased tenant', external_id = NULL, status = 'erased' WHERE id = ?").run(tenantId);
      this.db.prepare("INSERT INTO privacy_receipts (id, tenant_fingerprint, request_type, result_hash, created_at) VALUES (?, ?, 'erase', ?, ?)")
        .run(requestId, hmacHex(this.config.auditKey, tenantId), resultHash, createdAt);
    });
    return { requestId, resultHash, ...summary };
  }

  setRetention(tenantId, { retentionDays }, principal) {
    this.requireActiveTenant(tenantId);
    assert(Number.isInteger(retentionDays) && retentionDays >= 1 && retentionDays <= 3650, 400, "validation_error", "retentionDays must be between 1 and 3650");
    this.db.prepare("UPDATE tenants SET retention_days = ? WHERE id = ?").run(retentionDays, tenantId);
    appendAudit(this.db, this.config.auditKey, { tenantId, actorId: principal.id, actorType: principal.type, action: "privacy.retention.updated", targetType: "tenant", targetId: tenantId, metadata: { retentionDays } });
    return { tenantId, retentionDays };
  }

  enforceRetention(principal = { id: "retention-worker", type: "service" }) {
    const tenants = this.db.prepare("SELECT id, retention_days FROM tenants WHERE status = 'active'").all();
    const result = { tenantsChecked: tenants.length, documentsDeleted: 0, skippedLegalHold: 0 };
    for (const tenant of tenants) {
      if (this.db.prepare("SELECT 1 FROM legal_holds WHERE tenant_id = ? AND active = 1 LIMIT 1").get(tenant.id)) { result.skippedLegalHold += 1; continue; }
      const cutoff = new Date(Date.now() - tenant.retention_days * 86_400_000).toISOString();
      const documents = this.db.prepare("SELECT id FROM documents WHERE tenant_id = ? AND status = 'stored' AND deleted_at IS NULL AND created_at < ?").all(tenant.id, cutoff);
      for (const document of documents) { this.deleteDocument(tenant.id, document.id, principal); result.documentsDeleted += 1; }
    }
    return result;
  }

  addLegalHold(tenantId, { reason }, principal) {
    this.requireActiveTenant(tenantId);
    assert(reason, 400, "validation_error", "Legal hold reason is required");
    const hold = { id: randomUUID(), tenantId, reason, createdBy: principal.id, createdAt: now() };
    this.db.prepare("INSERT INTO legal_holds (id, tenant_id, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(hold.id, tenantId, reason, hold.createdBy, hold.createdAt);
    appendAudit(this.db, this.config.auditKey, { tenantId, actorId: principal.id, actorType: principal.type, action: "privacy.legal_hold.created", targetType: "legal_hold", targetId: hold.id, metadata: { reason } });
    return hold;
  }

  registerWebhook(tenantId, { url, eventTypes }, principal) {
    this.requireActiveTenant(tenantId);
    url = validateWebhookUrl(url);
    assert(Array.isArray(eventTypes) && eventTypes.length, 400, "validation_error", "At least one event type is required");
    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const encrypted = encryptBuffer(Buffer.from(secret), this.config.masterKey, `webhook:${id}`);
    this.db.prepare(`INSERT INTO webhook_endpoints
      (id, tenant_id, url, secret_ciphertext, secret_iv, secret_tag, event_types_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, tenantId, url, encrypted.ciphertext.toString("base64"), encrypted.iv.toString("base64"), encrypted.tag.toString("base64"), JSON.stringify(eventTypes), now());
    appendAudit(this.db, this.config.auditKey, { tenantId, actorId: principal.id, actorType: principal.type, action: "webhook.created", targetType: "webhook", targetId: id, metadata: { url, eventTypes } });
    return { id, tenantId, url, eventTypes, secret };
  }

  audit(tenantId, limit) {
    return { validChain: verifyAuditChain(this.db, this.config.auditKey, tenantId), events: listAudit(this.db, tenantId, limit) };
  }

  auditPlatform(principal, action, targetType, targetId) {
    appendAudit(this.db, this.config.auditKey, { tenantId: "platform", actorId: principal.id, actorType: principal.type, action, targetType, targetId, metadata: {} });
  }
}
