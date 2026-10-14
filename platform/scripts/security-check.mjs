import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const failures = [];
const requirePattern = (file, pattern, message) => { if (!pattern.test(read(file))) failures.push(message); };
const forbidPattern = (file, pattern, message) => { if (pattern.test(read(file))) failures.push(message); };

forbidPattern("../app/runtime.js", /\.innerHTML\s*=/, "Frontend contains an innerHTML assignment");
requirePattern("src/config.mjs", /ALLOW_INSECURE_DEV_AUTH, false/, "Development authentication is not default-deny");
requirePattern("src/db.mjs", /PRIMARY KEY\(partner_client_id, tenant_id, resource_type, external_id\)/, "External mapping key is not tenant-bound");
requirePattern("src/storage.mjs", /assertObjectPath\(config, tenantId, path\)/, "Storage path boundary validation is missing");
for (const file of ["src/config.mjs", "src/auth.mjs", "src/app.mjs", "src/service.mjs", "../app/runtime.js"]) {
  forbidPattern(file, /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9]{20,})/, `${file} contains a probable credential`);
}

if (failures.length) {
  for (const failure of failures) console.error(`SECURITY CHECK FAILED: ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Security source checks passed");
}
