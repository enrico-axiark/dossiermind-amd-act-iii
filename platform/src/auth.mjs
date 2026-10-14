import { createPublicKey, verify } from "node:crypto";
import { HttpError, assert } from "./errors.mjs";

const oidcCache = new Map();
const OIDC_MAX_BYTES = 1024 * 1024;
const JWT_PART_MAX_CHARS = 8192;

function decodePart(value, name) {
  if (typeof value !== "string" || value.length < 2 || value.length > JWT_PART_MAX_CHARS || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HttpError(401, "invalid_token", `JWT ${name} is malformed`);
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); }
  catch { throw new HttpError(401, "invalid_token", `JWT ${name} is malformed`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(401, "invalid_token", `JWT ${name} must be an object`);
  return parsed;
}

function audienceMatches(actual, expected) {
  return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
}

async function getOidcKeys(issuer) {
  const cached = oidcCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const discoveryUrl = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const issuerUrl = new URL(issuer);
  assert(issuerUrl.protocol === "https:", 503, "oidc_configuration_invalid", "OIDC issuer must use HTTPS");
  const discoveryResponse = await fetch(discoveryUrl, { signal: AbortSignal.timeout(5000), redirect: "error" });
  assert(discoveryResponse.ok, 503, "oidc_unavailable", "OIDC discovery endpoint unavailable");
  assert((discoveryResponse.headers.get("content-type") ?? "").includes("application/json"), 503, "oidc_invalid_response", "OIDC discovery must return JSON");
  const discoveryBytes = Buffer.from(await discoveryResponse.arrayBuffer());
  assert(discoveryBytes.length <= OIDC_MAX_BYTES, 503, "oidc_invalid_response", "OIDC discovery response is too large");
  let discovery;
  try { discovery = JSON.parse(discoveryBytes.toString("utf8")); }
  catch { throw new HttpError(503, "oidc_invalid_response", "OIDC discovery JSON is invalid"); }
  assert(discovery.issuer === issuer, 503, "oidc_issuer_mismatch", "OIDC discovery issuer mismatch");
  const jwksUrl = new URL(discovery.jwks_uri);
  assert(jwksUrl.protocol === "https:" && jwksUrl.origin === issuerUrl.origin, 503, "oidc_configuration_invalid", "OIDC JWKS URL must use the issuer origin");
  const jwksResponse = await fetch(jwksUrl, { signal: AbortSignal.timeout(5000), redirect: "error" });
  assert(jwksResponse.ok, 503, "oidc_unavailable", "OIDC JWKS endpoint unavailable");
  assert((jwksResponse.headers.get("content-type") ?? "").includes("application/json"), 503, "oidc_invalid_response", "OIDC JWKS must return JSON");
  const jwksBytes = Buffer.from(await jwksResponse.arrayBuffer());
  assert(jwksBytes.length <= OIDC_MAX_BYTES, 503, "oidc_invalid_response", "OIDC JWKS response is too large");
  let jwks;
  try { jwks = JSON.parse(jwksBytes.toString("utf8")); }
  catch { throw new HttpError(503, "oidc_invalid_response", "OIDC JWKS JSON is invalid"); }
  const result = { keys: (jwks.keys ?? []).filter((key) => key.kty === "RSA" && (!key.use || key.use === "sig") && (!key.alg || key.alg === "RS256")), expiresAt: Date.now() + 5 * 60_000 };
  oidcCache.set(issuer, result);
  return result;
}

export async function verifyOidcToken(token, config) {
  assert(config.oidcIssuer, 503, "oidc_not_configured", "OIDC issuer is not configured");
  const parts = token.split(".");
  assert(parts.length === 3, 401, "invalid_token", "Bearer token is malformed");
  assert(token.length <= JWT_PART_MAX_CHARS * 3, 401, "invalid_token", "Bearer token is too large");
  assert(/^[A-Za-z0-9_-]+$/.test(parts[2]) && parts[2].length <= JWT_PART_MAX_CHARS, 401, "invalid_token", "JWT signature is malformed");
  const header = decodePart(parts[0], "header");
  const claims = decodePart(parts[1], "claims");
  assert(header.alg === "RS256", 401, "invalid_token", "Only RS256 OIDC tokens are accepted");
  assert(typeof header.kid === "string" && header.kid.length >= 1 && header.kid.length <= 256, 401, "invalid_token", "JWT key identifier is invalid");
  const keySet = await getOidcKeys(config.oidcIssuer);
  const jwk = keySet.keys.find((item) => item.kid === header.kid && item.kty === "RSA");
  assert(jwk, 401, "invalid_token", "Signing key not found");
  let valid = false;
  try { valid = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url")); }
  catch { throw new HttpError(401, "invalid_token", "Token signature is invalid"); }
  assert(valid, 401, "invalid_token", "Token signature is invalid");
  const now = Math.floor(Date.now() / 1000);
  assert(typeof claims.sub === "string" && claims.sub.length >= 1 && claims.sub.length <= 255, 401, "invalid_token", "Token subject is invalid");
  assert(claims.iss === config.oidcIssuer, 401, "invalid_token", "Token issuer is invalid");
  assert(audienceMatches(claims.aud, config.oidcAudience), 401, "invalid_token", "Token audience is invalid");
  assert(typeof claims.exp === "number" && Number.isFinite(claims.exp) && claims.exp > now, 401, "invalid_token", "Token has expired");
  if (claims.nbf != null) assert(typeof claims.nbf === "number" && Number.isFinite(claims.nbf) && claims.nbf <= now, 401, "invalid_token", "Token is not active yet");
  return claims;
}

function parseDevToken(token) {
  assert(token.startsWith("dev."), 401, "invalid_token", "Development token is malformed");
  let payload;
  try {
    payload = JSON.parse(Buffer.from(token.slice(4), "base64url").toString("utf8"));
  } catch {
    throw new HttpError(401, "invalid_token", "Development token payload is malformed");
  }
  assert(payload.sub, 401, "invalid_token", "Development token subject is required");
  return {
    sub: payload.sub,
    tenant_ids: payload.tenant_ids ?? [],
    role: payload.role ?? "user",
    scope: payload.scope ?? "",
    token_type: "development",
  };
}

export async function authenticate(request, config) {
  const header = request.headers.authorization ?? "";
  assert(header.startsWith("Bearer "), 401, "authentication_required", "Bearer token required");
  const token = header.slice(7).trim();
  const claims = token.startsWith("dev.")
    ? (assert(config.allowInsecureDevAuth, 401, "invalid_token", "Development authentication is disabled"), parseDevToken(token))
    : await verifyOidcToken(token, config);
  const scopes = new Set(String(claims.scope ?? "").split(/\s+/).filter(Boolean));
  return {
    id: claims.sub,
    type: claims.client_id && claims.client_id === claims.sub ? "service" : "user",
    role: claims.role ?? "user",
    scopes,
    claimedTenantIds: new Set(claims.tenant_ids ?? []),
    rawClaims: claims,
  };
}

export function requireScope(principal, scope) {
  if (principal.scopes.has("platform:admin") || principal.scopes.has(scope)) return;
  throw new HttpError(403, "insufficient_scope", `Required scope: ${scope}`);
}

export function authorizeTenant(db, principal, tenantId, scope) {
  if (principal.scopes.has("platform:admin")) return { role: "platform_admin", scopes: ["*"] };
  // Token tenant claims never replace live database authorization.
  assert(db.prepare("SELECT 1 FROM tenants WHERE id=? AND status='active'").get(tenantId), 403, "tenant_access_denied", "Tenant is not available");
  const row = db.prepare("SELECT role, scopes_json FROM memberships WHERE tenant_id = ? AND user_id = ?").get(tenantId, principal.id);
  assert(row, 403, "tenant_access_denied", "Principal has no membership in this tenant");
  const membershipScopes = new Set(JSON.parse(row.scopes_json));
  assert(membershipScopes.has(scope) || membershipScopes.has("*"), 403, "insufficient_scope", `Required tenant scope: ${scope}`);
  return { role: row.role, scopes: [...membershipScopes] };
}
