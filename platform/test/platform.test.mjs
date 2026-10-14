import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createPlatformApp } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";

function devToken(payload) {
  return `dev.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

async function setup(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "dossiermind-platform-"));
  const config = loadConfig({
    nodeEnv: "test",
    baseDir: directory,
    dbPath: ":memory:",
    storageRoot: join(directory, "objects"),
    masterKey: randomBytes(32),
    auditKey: randomBytes(32),
    allowInsecureDevAuth: true,
    allowedOrigins: [],
    ...overrides,
  });
  const app = createPlatformApp(config);
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  return { ...app, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function close(app) {
  await new Promise((resolve) => app.server.close(resolve));
  app.db.close();
}

test("tenant isolation, encrypted storage and audit chain", async () => {
  const app = await setup();
  try {
    const admin = { id: "admin", type: "user", scopes: new Set(["platform:admin"]), role: "platform_admin" };
    const org = app.service.createOrganization({ name: "Studio Test", type: "studio" }, admin);
    app.service.createUser({ id: "user-a", email: "a@example.test", displayName: "User A" }, admin);
    const tenantA = app.service.createTenant({ organizationId: org.id, externalId: "A", name: "Tenant A" }, admin);
    const tenantB = app.service.createTenant({ organizationId: org.id, externalId: "B", name: "Tenant B" }, admin);
    const scopes = ["tenant:read", "documents:read", "documents:write", "documents:delete", "audit:read", "privacy:export"];
    app.service.addMembership(tenantA.id, { userId: "user-a", role: "accountant", scopes }, admin);

    const token = devToken({ sub: "user-a", role: "accountant", scope: "" });
    const content = Buffer.from("%PDF-1.4\ndocumento fiscale riservato");
    const upload = await fetch(`${app.baseUrl}/v1/tenants/${tenantA.id}/documents`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/pdf", "x-filename": "fattura.pdf", "idempotency-key": "upload-1" },
      body: content,
    });
    assert.equal(upload.status, 201);
    const document = await upload.json();
    assert.equal(document.tenantId, tenantA.id);

    const forbidden = await fetch(`${app.baseUrl}/v1/tenants/${tenantB.id}/documents`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(forbidden.status, 403);

    const download = await fetch(`${app.baseUrl}/v1/tenants/${tenantA.id}/documents/${document.id}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), content);

    const audit = await fetch(`${app.baseUrl}/v1/tenants/${tenantA.id}/audit`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(audit.status, 200);
    const auditBody = await audit.json();
    assert.equal(auditBody.validChain, true);
    assert.ok(auditBody.events.some((event) => event.action === "document.stored"));
    assert.ok(auditBody.events.some((event) => event.action === "document.read"));
  } finally {
    await close(app);
  }
});

test("privacy export and erase remove tenant content", async () => {
  const app = await setup();
  try {
    const admin = { id: "admin", type: "user", scopes: new Set(["platform:admin"]), role: "platform_admin" };
    const org = app.service.createOrganization({ name: "PMI Test", type: "pmi" }, admin);
    const tenant = app.service.createTenant({ organizationId: org.id, name: "Tenant Privacy" }, admin);
    const document = app.service.uploadDocument(tenant.id, { filename: "contratto.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4\nsecret"), idempotencyKey: null }, admin);
    const exported = app.service.exportTenant(tenant.id, admin);
    assert.equal(exported.payload.documents.length, 1);
    assert.equal(exported.payload.documents[0].id, document.id);
    assert.match(exported.manifestSha256, /^[a-f0-9]{64}$/);

    const erased = app.service.eraseTenant(tenant.id, admin);
    assert.equal(erased.documentsDeleted, 1);
    assert.equal(app.service.getTenant(tenant.id).status, "erased");
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM documents WHERE tenant_id = ?").get(tenant.id).count, 0);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM tenant_keys WHERE tenant_id = ?").get(tenant.id).count, 0);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM privacy_receipts WHERE id = ?").get(erased.requestId).count, 1);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM privacy_requests WHERE tenant_id = ?").get(tenant.id).count, 0);
    assert.equal(app.db.prepare("SELECT COUNT(*) AS count FROM legal_holds WHERE tenant_id = ?").get(tenant.id).count, 0);
  } finally {
    await close(app);
  }
});

test("legal hold blocks erasure", async () => {
  const app = await setup();
  try {
    const admin = { id: "admin", type: "user", scopes: new Set(["platform:admin"]), role: "platform_admin" };
    const org = app.service.createOrganization({ name: "Studio Hold", type: "studio" }, admin);
    const tenant = app.service.createTenant({ organizationId: org.id, name: "Tenant Hold" }, admin);
    app.service.addLegalHold(tenant.id, { reason: "Contenzioso attivo" }, admin);
    assert.throws(() => app.service.eraseTenant(tenant.id, admin), (error) => error.code === "legal_hold_active");
  } finally {
    await close(app);
  }
});

test("partner mappings require an explicit tenant grant and cannot be reassigned", async () => {
  const app = await setup();
  try {
    const admin = { id: "admin", type: "user", scopes: new Set(["platform:admin"]), role: "platform_admin" };
    const studio = app.service.createOrganization({ name: "Studio", type: "studio" }, admin);
    const partnerOrg = app.service.createOrganization({ name: "Partner", type: "partner" }, admin);
    const tenantA = app.service.createTenant({ organizationId: studio.id, name: "A" }, admin);
    const tenantB = app.service.createTenant({ organizationId: studio.id, name: "B" }, admin);
    const partner = app.service.createPartnerClient({ organizationId: partnerOrg.id, name: "ERP" }, admin);
    assert.throws(() => app.service.upsertExternalMapping(tenantA.id, { partnerClientId: partner.id, resourceType: "client", externalId: "42", internalId: "a" }, admin), (error) => error.code === "partner_tenant_denied");
    app.service.grantPartnerTenant(partner.id, tenantA.id, admin);
    app.service.upsertExternalMapping(tenantA.id, { partnerClientId: partner.id, resourceType: "client", externalId: "42", internalId: "a" }, admin);
    assert.throws(() => app.service.upsertExternalMapping(tenantB.id, { partnerClientId: partner.id, resourceType: "client", externalId: "42", internalId: "b" }, admin), (error) => error.code === "partner_tenant_denied");
    app.service.grantPartnerTenant(partner.id, tenantB.id, admin);
    app.service.upsertExternalMapping(tenantB.id, { partnerClientId: partner.id, resourceType: "client", externalId: "42", internalId: "b" }, admin);
    assert.equal(app.service.getExternalMapping(tenantA.id, { partnerClientId: partner.id, resourceType: "client", externalId: "42" }).internalId, "a");
    assert.equal(app.service.getExternalMapping(tenantB.id, { partnerClientId: partner.id, resourceType: "client", externalId: "42" }).internalId, "b");
  } finally { await close(app); }
});

test("upload validation rejects executable, malware marker and MIME mismatch", async () => {
  const app = await setup();
  try {
    const admin = { id: "admin", type: "user", scopes: new Set(["platform:admin"]), role: "platform_admin" };
    const org = app.service.createOrganization({ name: "Upload", type: "pmi" }, admin);
    const tenant = app.service.createTenant({ organizationId: org.id, name: "Upload" }, admin);
    const upload = (bytes, mimeType = "application/octet-stream") => app.service.uploadDocument(tenant.id, { filename: "test.bin", mimeType, bytes, idempotencyKey: null }, admin);
    assert.throws(() => upload(Buffer.from([0x4d, 0x5a, 0, 0])), (error) => error.code === "unsafe_upload");
    assert.throws(() => upload(Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")), (error) => error.code === "malware_detected");
    assert.throws(() => upload(Buffer.from("not a pdf"), "application/pdf"), (error) => error.code === "mime_mismatch");
  } finally { await close(app); }
});

test("legal hold blocks document deletion and retention enforcement skips held tenants", async () => {
  const app = await setup();
  try {
    const admin = { id: "admin", type: "user", scopes: new Set(["platform:admin"]), role: "platform_admin" };
    const org = app.service.createOrganization({ name: "Retention", type: "studio" }, admin);
    const tenant = app.service.createTenant({ organizationId: org.id, name: "Retention", retentionDays: 1 }, admin);
    const document = app.service.uploadDocument(tenant.id, { filename: "old.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4\nold"), idempotencyKey: null }, admin);
    app.db.prepare("UPDATE documents SET created_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", document.id);
    app.service.addLegalHold(tenant.id, { reason: "Contenzioso" }, admin);
    assert.throws(() => app.service.deleteDocument(tenant.id, document.id, admin), (error) => error.code === "legal_hold_active");
    assert.equal(app.service.enforceRetention(admin).skippedLegalHold, 1);
    app.db.prepare("UPDATE legal_holds SET active = 0, released_at = ? WHERE tenant_id = ?").run(new Date().toISOString(), tenant.id);
    assert.equal(app.service.enforceRetention(admin).documentsDeleted, 1);
  } finally { await close(app); }
});

test("webhooks reject local targets and frontend has no dynamic innerHTML sink", async () => {
  const app = await setup();
  try {
    const admin = { id: "admin", type: "user", scopes: new Set(["platform:admin"]), role: "platform_admin" };
    const org = app.service.createOrganization({ name: "Hooks", type: "pmi" }, admin);
    const tenant = app.service.createTenant({ organizationId: org.id, name: "Hooks" }, admin);
    for (const url of ["https://127.0.0.1/callback", "https://[fc00::1]/callback", "https://[fe80::1]/callback", "https://[::ffff:127.0.0.1]/callback"]) {
      assert.throws(() => app.service.registerWebhook(tenant.id, { url, eventTypes: ["document.created"] }, admin), (error) => error.code === "webhook_target_blocked");
    }
    assert.equal(app.service.registerWebhook(tenant.id, { url: "https://[2606:4700:4700::1111]/callback", eventTypes: ["document.created"] }, admin).url, "https://[2606:4700:4700::1111]/callback");
    const frontend = new URL("../../app/runtime.js", import.meta.url);
    assert.doesNotMatch(readFileSync(frontend, "utf8"), /\.innerHTML\s*=/);
  } finally { await close(app); }
});

test("development auth is opt-in and rate limiting returns 429", async () => {
  assert.equal(loadConfig({ nodeEnv: "test", baseDir: tmpdir(), masterKey: randomBytes(32), auditKey: randomBytes(32) }).allowInsecureDevAuth, false);
  assert.throws(() => loadConfig({ nodeEnv: "production", host: "127.0.0.1", baseDir: tmpdir(), masterKey: randomBytes(32), auditKey: randomBytes(32), allowInsecureDevAuth: true }));
  assert.throws(() => loadConfig({ nodeEnv: "test", host: "0.0.0.0", baseDir: tmpdir(), masterKey: randomBytes(32), auditKey: randomBytes(32), allowInsecureDevAuth: true }));
  const app = await setup({ rateLimitMax: 1, rateLimitWindowMs: 60_000 });
  try {
    assert.equal((await fetch(`${app.baseUrl}/health`)).status, 200);
    assert.equal((await fetch(`${app.baseUrl}/health`)).status, 429);
    const token = devToken({ sub: "authenticated-user", scope: "tenant:read" });
    assert.equal((await fetch(`${app.baseUrl}/v1/me`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
  } finally { await close(app); }
});

test("malformed OIDC JWT fails closed with 401", async () => {
  const app = await setup({ allowInsecureDevAuth: false, oidcIssuer: "https://identity.invalid" });
  try {
    for (const malformed of ["x.y.z", "e30.W10.signature", `${"a".repeat(9000)}.e30.signature`]) {
      const response = await fetch(`${app.baseUrl}/v1/me`, { headers: { authorization: `Bearer ${malformed}` } });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, "invalid_token");
    }
  } finally { await close(app); }
});
