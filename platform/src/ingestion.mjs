import {executeReport,renderReport} from "./reports.mjs";
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readEncryptedObject, storeEncryptedObject, deleteEncryptedObject } from './storage.mjs';
import { authorizeTenant } from './auth.mjs';
import { transaction } from './db.mjs';
import { appendAudit } from './audit.mjs';
import { sha256 } from './crypto.mjs';
import { assert } from './errors.mjs';

const script = fileURLToPath(new URL('../parsers/extract.py', import.meta.url));
export function parseDocument(bytes, mime, filename, config) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.pythonExecutable, [script, mime, filename], {stdio:['pipe','pipe','pipe']});
    const chunks=[];let size=0;let settled=false;
    const fail=code=>{if(!settled){settled=true;clearTimeout(timer);child.kill('SIGKILL');reject(Object.assign(new Error(code),{code}));}};
    const timer=setTimeout(()=>fail('parser_timeout'),config.parserTimeoutMs);
    child.on('error',()=>fail('parser_unavailable'));
    child.stdin.on('error',()=>{});
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>8*1024*1024)fail('extraction_output_limit');else chunks.push(chunk);});
    // Consume diagnostics without storing document content or paths in logs.
    child.stderr.on('data',()=>{});
    child.on('close',code=>{
      if(settled)return;
      clearTimeout(timer);
      let parsed;try{parsed=JSON.parse(Buffer.concat(chunks).toString());}catch{return fail('parser_invalid_output');}
      if(code!==0||parsed.error)return fail(parsed.error||'parser_failed');
      if(!Array.isArray(parsed.fragments)||!Array.isArray(parsed.warnings)||typeof parsed.parserVersion!=='string')return fail('parser_invalid_output');
      settled=true;resolve(parsed);
    });
    child.stdin.end(bytes);
  });
}

export function readExtraction(db, config, tenantId, documentId) {
  const row=db.prepare(`SELECT e.* FROM document_extractions e JOIN documents d ON d.id=e.document_id
    WHERE e.tenant_id=? AND e.document_id=? AND d.deleted_at IS NULL AND d.status='stored'`).get(tenantId,documentId);
  if(!row)return null;
  return JSON.parse(readEncryptedObject(db,config,tenantId,row.bundle_id,row.stored_path).toString());
}

export class IngestionWorker {
  constructor(db,config,{parser=parseDocument,reportRenderer=renderReport}={}) {this.db=db;this.config=config;this.parser=parser;this.reportRenderer=reportRenderer;this.id=randomUUID();this.busy=false;this.stopped=false;}
  authorized(job) {
    const tenant=this.db.prepare('SELECT status,access_epoch FROM tenants WHERE id=?').get(job.tenant_id);
    assert(tenant?.status==='active'&&tenant.access_epoch===job.access_epoch,403,'job_access_revoked','Job authorization changed');
    if(job.authority!=='platform_admin') {
      const principal={id:job.created_by,scopes:new Set(),claimedTenantIds:new Set()};
      authorizeTenant(this.db,principal,job.tenant_id,'jobs:write');
      authorizeTenant(this.db,principal,job.tenant_id,'documents:read');
    }
  }
  owns(job) {return this.db.prepare("SELECT 1 FROM jobs WHERE id=? AND status='running' AND lease_owner=? AND lease_until>?").get(job.id,this.id,Date.now());}
  async tick() {
    if(this.busy||this.stopped)return false;
    this.busy=true;let job,heartbeat;
    try {
      job=transaction(this.db,()=>{
        const row=this.db.prepare("SELECT * FROM jobs WHERE status='queued' OR (status='running' AND lease_until<?) ORDER BY created_at LIMIT 1").get(Date.now());
        if(!row)return null;
        if(row.attempts>=3){this.db.prepare("UPDATE jobs SET status='failed',error_code='retry_limit',completed_at=? WHERE id=?").run(new Date().toISOString(),row.id);return null;}
        this.db.prepare("UPDATE jobs SET status='running',lease_owner=?,lease_until=?,attempts=attempts+1 WHERE id=?").run(this.id,Date.now()+120000,row.id);
        return this.db.prepare('SELECT * FROM jobs WHERE id=?').get(row.id);
      });
      if(!job)return false;
      this.authorized(job);
      if(job.type==='report'){await executeReport(this,job,this.reportRenderer);return true;}
      assert(job.type==='ingestion',409,'job_type_not_implemented','This job type is not implemented yet');
      const input=JSON.parse(job.input_json),outcomes=[];const started=Date.now();
      heartbeat=setInterval(()=>this.db.prepare("UPDATE jobs SET lease_until=? WHERE id=? AND status='running' AND lease_owner=?").run(Date.now()+120000,job.id,this.id),15000);
      for(const documentId of input.documentIds) {
        this.authorized(job);assert(this.owns(job),409,'job_lease_lost','Worker lease lost');
        assert(Date.now()-started<600000,408,'job_timeout','Job time limit exceeded');
        const document=this.db.prepare("SELECT * FROM documents WHERE id=? AND tenant_id=? AND deleted_at IS NULL AND status='stored'").get(documentId,job.tenant_id);
        assert(document,404,'document_not_found','Document no longer available');
        const existing=this.db.prepare('SELECT source_sha256,parser_version,status,fragment_count FROM document_extractions WHERE document_id=?').get(documentId);
        if(existing?.source_sha256===document.sha256&&existing.parser_version==='act-iii-parser-0.1.2') {
          outcomes.push({documentId,status:existing.status,fragmentCount:existing.fragment_count,reused:true});
        } else {
          let parsed;
          try {
            const bytes=readEncryptedObject(this.db,this.config,job.tenant_id,document.id,document.stored_path);
            assert(sha256(bytes)===document.sha256,409,'source_hash_mismatch','Original changed');
            parsed=await this.parser(bytes,document.mime_type,document.original_filename,this.config);
          } catch(error) {
            this.authorized(job);assert(this.owns(job),409,'job_lease_lost','Worker lease lost');
            outcomes.push({documentId,status:'rejected',errorCode:error.code||'parser_failed'});
          }
          if(parsed) {
            this.authorized(job);assert(this.owns(job),409,'job_lease_lost','Worker lease lost');
            const bundleId=randomUUID(),createdAt=new Date().toISOString();
            const bundle={documentId,tenantId:job.tenant_id,sourceHash:document.sha256,parserVersion:parsed.parserVersion,
              status:parsed.status,warnings:parsed.warnings,createdAt,fragments:parsed.fragments.map((fragment,index)=>({
                ...fragment,id:`${documentId}:${index+1}`,documentId,tenantId:job.tenant_id,sourceHash:document.sha256}))};
            let path,previous;
            try {transaction(this.db,()=>{
              this.authorized(job);assert(this.owns(job),409,'job_lease_lost','Worker lease lost');
              assert(this.db.prepare("SELECT 1 FROM documents WHERE id=? AND deleted_at IS NULL AND status='stored'").get(documentId),404,'document_not_found','Source deleted');
              path=storeEncryptedObject(this.db,this.config,job.tenant_id,bundleId,Buffer.from(JSON.stringify(bundle)));
              previous=this.db.prepare('SELECT stored_path FROM document_extractions WHERE document_id=?').get(documentId);
              this.db.prepare(`INSERT INTO document_extractions VALUES (?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(document_id) DO UPDATE SET source_sha256=excluded.source_sha256,bundle_id=excluded.bundle_id,
                stored_path=excluded.stored_path,parser_version=excluded.parser_version,fragment_count=excluded.fragment_count,
                status=excluded.status,warnings_json=excluded.warnings_json,created_at=excluded.created_at`)
                .run(documentId,job.tenant_id,document.sha256,bundleId,path,parsed.parserVersion,bundle.fragments.length,parsed.status,JSON.stringify(parsed.warnings),createdAt);
              appendAudit(this.db,this.config.auditKey,{tenantId:job.tenant_id,actorId:job.created_by,actorType:'user',action:'document.extracted',targetType:'document',targetId:documentId,metadata:{sourceHash:document.sha256,parserVersion:parsed.parserVersion,fragmentCount:bundle.fragments.length,status:parsed.status}});
            });}catch(error){if(path)deleteEncryptedObject(path,this.config,job.tenant_id);throw error;}
            if(previous)deleteEncryptedObject(previous.stored_path,this.config,job.tenant_id);
            outcomes.push({documentId,status:parsed.status,fragmentCount:bundle.fragments.length,warnings:parsed.warnings});
          }
        }
        this.db.prepare("UPDATE jobs SET progress_json=? WHERE id=? AND lease_owner=? AND status='running'").run(JSON.stringify({phase:'parsing',completed:outcomes.length,total:input.documentIds.length,outcomes}),job.id,this.id);
      }
      transaction(this.db,()=>{
        this.authorized(job);assert(this.owns(job),409,'job_lease_lost','Worker lease lost');
        const status=outcomes.some(x=>x.status==='rejected')?'completed_with_errors':'completed';
        this.db.prepare('UPDATE jobs SET status=?,output_json=?,completed_at=?,lease_owner=NULL,lease_until=NULL WHERE id=?').run(status,JSON.stringify({stage:'deterministic_extraction',aiExecuted:false,outcomes}),new Date().toISOString(),job.id);
        appendAudit(this.db,this.config.auditKey,{tenantId:job.tenant_id,actorId:job.created_by,actorType:'user',action:'job.completed',targetType:'job',targetId:job.id,metadata:{status,aiExecuted:false}});
      });
      return true;
    }catch(error){
      if(job)this.db.prepare("UPDATE jobs SET status=?,error_code=?,completed_at=?,lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=? AND status='running'").run(error.code==='job_access_revoked'||error.code==='tenant_access_denied'?'cancelled':'failed',error.code||'worker_failed',new Date().toISOString(),job.id,this.id);
      return false;
    }finally{clearInterval(heartbeat);this.busy=false;}
  }
  start(){this.timer=setInterval(()=>void this.tick(),1000);void this.tick();}
  async stop(){this.stopped=true;clearInterval(this.timer);while(this.busy)await new Promise(resolve=>setTimeout(resolve,50));}
}
