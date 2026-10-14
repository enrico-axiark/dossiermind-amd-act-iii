import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

function bool(value, fallback = false) {
  if (value == null) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function keyFromEnv(name, { allowEphemeral }) {
  const raw = process.env[name];
  if (raw) {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error(`${name} must contain exactly 32 bytes encoded as base64`);
    return key;
  }
  if (!allowEphemeral) throw new Error(`${name} is required outside development/test`);
  return randomBytes(32);
}

export function loadConfig(overrides = {}) {
  const nodeEnv = overrides.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const allowEphemeral = nodeEnv !== "production";
  const baseDir = overrides.baseDir ?? process.cwd();
  const config = {
    nodeEnv,
    pythonExecutable: overrides.pythonExecutable ?? process.env.PYTHON_EXECUTABLE ?? "python3",
    amdInferenceEnabled: overrides.amdInferenceEnabled ?? bool(process.env.AMD_INFERENCE_ENABLED, false),
    amdBaseUrl: overrides.amdBaseUrl ?? process.env.AMD_INFERENCE_BASE_URL ?? '',
    amdModel: overrides.amdModel ?? process.env.AMD_MODEL ?? '',
    amdResponseModel: overrides.amdResponseModel ?? process.env.AMD_RESPONSE_MODEL ?? '',
    amdModelRevision: overrides.amdModelRevision ?? process.env.AMD_MODEL_REVISION ?? '',
    amdApiKey: overrides.amdApiKey ?? process.env.AMD_API_KEY ?? '',
    amdBudgetConfirmed: overrides.amdBudgetConfirmed ?? bool(process.env.AMD_BUDGET_CONFIRMED, false),
    amdRequestLimit: overrides.amdRequestLimit ?? int(process.env.AMD_REQUEST_LIMIT ?? process.env.AMD_PROCESS_REQUEST_LIMIT, 0),
    amdVisionEnabled: overrides.amdVisionEnabled ?? bool(process.env.AMD_VISION_ENABLED),
    amdVisionModel: overrides.amdVisionModel ?? process.env.AMD_VISION_MODEL ?? '',
    amdVisionResponseModel: overrides.amdVisionResponseModel ?? process.env.AMD_VISION_RESPONSE_MODEL ?? '',
    amdVisionModelRevision: overrides.amdVisionModelRevision ?? process.env.AMD_VISION_MODEL_REVISION ?? '',
    amdVisionReasoningEffort: overrides.amdVisionReasoningEffort ?? process.env.AMD_VISION_REASONING_EFFORT ?? '',
    pdftoppmExecutable: overrides.pdftoppmExecutable ?? process.env.PDFTOPPM_EXECUTABLE ?? 'pdftoppm',
    amdResponseFormat: overrides.amdResponseFormat ?? process.env.AMD_RESPONSE_FORMAT ?? 'json_schema',
    amdReasoningEffort: overrides.amdReasoningEffort ?? process.env.AMD_REASONING_EFFORT ?? '',
    amdTimeoutMs: overrides.amdTimeoutMs ?? int(process.env.AMD_TIMEOUT_MS, 60000),
    amdMaxOutputTokens: overrides.amdMaxOutputTokens ?? int(process.env.AMD_MAX_OUTPUT_TOKENS, 1024),
    parserTimeoutMs: overrides.parserTimeoutMs ?? 20000,
    host: overrides.host ?? process.env.HOST ?? "127.0.0.1",
    port: overrides.port ?? int(process.env.PORT, 8787),
    dbPath: resolve(baseDir, overrides.dbPath ?? process.env.DB_PATH ?? "./data/dossiermind.sqlite"),
    storageRoot: resolve(baseDir, overrides.storageRoot ?? process.env.STORAGE_ROOT ?? "./data/objects"),
    masterKey: overrides.masterKey ?? keyFromEnv("MASTER_KEY_B64", { allowEphemeral }),
    auditKey: overrides.auditKey ?? keyFromEnv("AUDIT_KEY_B64", { allowEphemeral }),
    oidcIssuer: overrides.oidcIssuer ?? process.env.OIDC_ISSUER ?? "",
    publicBaseUrl: overrides.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? "",
    oidcClientId: overrides.oidcClientId ?? process.env.OIDC_CLIENT_ID ?? "",
    oidcAuthorizationUrl: overrides.oidcAuthorizationUrl ?? process.env.OIDC_AUTHORIZATION_URL ?? "",
    oidcTokenUrl: overrides.oidcTokenUrl ?? process.env.OIDC_TOKEN_URL ?? "",
    oidcBrowserScope: overrides.oidcBrowserScope ?? process.env.OIDC_BROWSER_SCOPE ?? "openid",
    oidcAudience: overrides.oidcAudience ?? process.env.OIDC_AUDIENCE ?? "dossiermind-api",
    allowedOrigins: overrides.allowedOrigins ?? (process.env.ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    allowInsecureDevAuth: overrides.allowInsecureDevAuth ?? bool(process.env.ALLOW_INSECURE_DEV_AUTH, false),
    maxUploadBytes: overrides.maxUploadBytes ?? int(process.env.MAX_UPLOAD_BYTES, 20 * 1024 * 1024),
    rateLimitWindowMs: overrides.rateLimitWindowMs ?? int(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitMax: overrides.rateLimitMax ?? int(process.env.RATE_LIMIT_MAX, 120),
    requestTimeoutMs: overrides.requestTimeoutMs ?? int(process.env.REQUEST_TIMEOUT_MS, 30_000),
    headersTimeoutMs: overrides.headersTimeoutMs ?? int(process.env.HEADERS_TIMEOUT_MS, 10_000),
  };
  if (config.allowInsecureDevAuth) {
    if (nodeEnv === "production") throw new Error("Development authentication cannot be enabled in production");
    if (!["127.0.0.1", "::1", "localhost"].includes(config.host)) throw new Error("Development authentication requires a loopback host");
  }
  if (!Number.isInteger(config.rateLimitMax) || config.rateLimitMax < 1) throw new Error("RATE_LIMIT_MAX must be a positive integer");
  if (!Number.isInteger(config.rateLimitWindowMs) || config.rateLimitWindowMs < 1000) throw new Error("RATE_LIMIT_WINDOW_MS must be at least 1000");
  return config;
}
