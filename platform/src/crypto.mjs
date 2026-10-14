import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function hmacHex(key, data) {
  return createHmac("sha256", key).update(data).digest("hex");
}

export function secureEqualText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function encryptBuffer(plaintext, key, aad = "") {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

export function decryptBuffer(ciphertext, key, iv, tag, aad = "") {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function wrapKey(tenantKey, masterKey, tenantId) {
  const encrypted = encryptBuffer(tenantKey, masterKey, `tenant-key:${tenantId}`);
  return {
    ciphertext: encrypted.ciphertext.toString("base64"),
    iv: encrypted.iv.toString("base64"),
    tag: encrypted.tag.toString("base64"),
  };
}

export function unwrapKey(record, masterKey, tenantId) {
  return decryptBuffer(
    Buffer.from(record.key_ciphertext, "base64"),
    masterKey,
    Buffer.from(record.key_iv, "base64"),
    Buffer.from(record.key_tag, "base64"),
    `tenant-key:${tenantId}`,
  );
}

export function encodeEncryptedBlob(plaintext, key, aad) {
  const encrypted = encryptBuffer(plaintext, key, aad);
  return Buffer.concat([encrypted.iv, encrypted.tag, encrypted.ciphertext]);
}

export function decodeEncryptedBlob(blob, key, aad) {
  if (blob.length < 28) throw new Error("Encrypted blob is invalid");
  return decryptBuffer(blob.subarray(28), key, blob.subarray(0, 12), blob.subarray(12, 28), aad);
}
