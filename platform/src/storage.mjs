import { mkdirSync, readFileSync, unlinkSync, writeFileSync, existsSync, realpathSync, renameSync } from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { decodeEncryptedBlob, encodeEncryptedBlob, unwrapKey, wrapKey } from "./crypto.mjs";

function tenantDirectory(root, tenantId) {
  if(typeof tenantId!=="string" || !/^[a-zA-Z0-9_-]+$/.test(tenantId))throw new Error("Invalid tenant storage identity");
  const safeTenant = tenantId;
  const directory = join(root, safeTenant);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

export function getTenantKey(db, config, tenantId) {
  let record = db.prepare("SELECT * FROM tenant_keys WHERE tenant_id = ?").get(tenantId);
  if (!record) {
    const wrapped = wrapKey(randomBytes(32), config.masterKey, tenantId);
    const createdAt = new Date().toISOString();
    db.prepare("INSERT INTO tenant_keys (tenant_id, key_ciphertext, key_iv, key_tag, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(tenantId, wrapped.ciphertext, wrapped.iv, wrapped.tag, createdAt);
    record = db.prepare("SELECT * FROM tenant_keys WHERE tenant_id = ?").get(tenantId);
  }
  return unwrapKey(record, config.masterKey, tenantId);
}

export function storeEncryptedObject(db, config, tenantId, objectId, plaintext) {
  if(typeof objectId!=="string" || !/^[a-zA-Z0-9_-]+$/.test(objectId))throw new Error("Invalid object storage identity");
  const key = getTenantKey(db, config, tenantId);
  const path = join(tenantDirectory(config.storageRoot, tenantId), `${objectId}.dmblob`);
  const temporary=path+"."+randomBytes(8).toString('hex')+".tmp";
  writeFileSync(temporary,encodeEncryptedBlob(plaintext,key,`document:${tenantId}:${objectId}`),{mode:0o600,flag:'wx'});
  try {renameSync(temporary,path);}catch(error){unlinkSync(temporary);throw error;}
  return relative(resolve(config.storageRoot),resolve(path));
}

export function readEncryptedObject(db, config, tenantId, objectId, path) {
  path = assertObjectPath(config, tenantId, path);
  const key = getTenantKey(db, config, tenantId);
  return decodeEncryptedBlob(readFileSync(path), key, `document:${tenantId}:${objectId}`);
}

export function deleteEncryptedObject(path, config = null, tenantId = null) {
  if (config && tenantId && path) path=assertObjectPath(config, tenantId, path);
  if (path && existsSync(path)) unlinkSync(path);
}

function assertObjectPath(config, tenantId, path) {
  const root = resolve(tenantDirectory(config.storageRoot, tenantId));
  const target = isAbsolute(path) ? resolve(path) : resolve(config.storageRoot,path);
  const rel = relative(root, target);
  if (!path || rel.startsWith("..") || rel.includes("/../") || rel === "") {
    throw new Error("Stored object path escapes the tenant storage boundary");
  }
  if(existsSync(target)) {
    const actualRelative=relative(realpathSync(root),realpathSync(target));
    if(actualRelative.startsWith('..')||isAbsolute(actualRelative)||actualRelative==='')throw new Error('Stored object symlink escapes tenant boundary');
  }
  return target;
}
