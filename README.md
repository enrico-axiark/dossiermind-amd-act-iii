# DossierMind — ACT III competition prototype

Public competition source release. Project code is licensed under MIT.
Source repository: https://github.com/enrico-axiark/dossiermind-amd-act-iii
Public demo: https://dossiermind-amd-act-iii.onrender.com/app/
Deployment is live; the core hosted walkthrough passed on 14 October 2026.
See `JUDGE-GUIDE.md` and `ONLINE-QUALIFICATION.md` for the tested scope and limits.
The final pitch, cover, edited captioned video and reviewer PDF are in `submission/`.
Only this prototype is in scope. It contains no production customer archive.
All supplied document examples are fabricated for testing and demonstration.

The application connects a synthetic private client or business and its
accountant: encrypted original files, parsing, sourced notes/wiki, a clickable
brain map, lexical retrieval, AMD Advisor, checklists, calculations and PDF
reports. AI outputs remain proposals; matching citations do not prove semantic
correctness or professional approval.

## Run locally

Use Node.js 24+, Python 3.11+ and Poppler (`pdftoppm`). Install Python dependencies
from `platform/parsers/requirements.txt` in a virtual environment. Set
`PYTHON_EXECUTABLE` to that environment's Python. From `platform/`, run:

```
node --env-file-if-exists=.env scripts/run-local.mjs
```

Open http://127.0.0.1:8787/app/ . The development launcher generates private
encryption/audit keys under ignored `platform/data/` and provisions synthetic
identities. Its development authentication is allowed only on loopback.
Synthetic documents can be loaded through the local demo interface.

## Real AMD inference

Inference is disabled by default. Provide `AMD_API_KEY` only in server-side
environment variables or an ignored `.env` file, never in browser code.
Set an explicitly authorized cumulative `AMD_REQUEST_LIMIT` and confirm
`AMD_BUDGET_CONFIRMED`; requests including uncertain/failed dispatches count.
Use the confirmed endpoint `https://developer.amd.com.cn/radeon/api/v1`,
model `DeepSeek-V4-Flash-Vision-Exp`, response model
`self-dploy/DeepSeek-V4-Flash-Vision-Exp`, `json_object` format and 4096 maximum
output tokens. Catalog identity was checked; underlying weights/hardware were
not independently inspected. No model fallback or automatic uncertain retry.
The synthetic local AMD walkthrough passed on 14 October 2026; a fresh copy
has no stored model responses and requires separately authorized credentials.

## Public hosting

Build the supplied `platform/Dockerfile` with the repository root as context.
`render.yaml` is a deployment candidate with a paid persistent disk, three
synthetic competition accounts and AMD disabled. Competition access is an
explicit opt-in, separate from local development and the existing OIDC/PKCE
integration. Accounts have separate random passwords, scrypt password hashes,
expiring secure HttpOnly cookies, CSRF protection and live database permissions.
They are shared demonstration profiles, not production customer identities.

Generate fresh secrets locally, specifying a private path outside this checkout:

```
node platform/scripts/prepare-competition-secrets.mjs /private/output/demo.env
```

Import the environment file only into the hosting service's private environment
settings. Keep its separate `.passwords.json` file private and supply demo login
instructions to the intended reviewers. Never commit either file. Render provides
the HTTPS origin through `RENDER_EXTERNAL_URL`; another host requires an explicit
`PUBLIC_BASE_URL`. Mount a persistent disk at `/app/data` and retain the distinct
32-byte base64 encryption/audit keys across all restarts.

`COMPETITION_SEED_SYNTHETIC=true` installs only the 22 hash-verified synthetic
originals and schedules deterministic parsing on the first start. It does not
call AMD, fabricate AI results, restore deleted documents or regrant revoked
memberships on later starts. The seed refuses an unrelated existing archive and
detects changed persistent encryption/audit keys.

Authorize a hosted inference budget separately before enabling AMD. Existing
local call usage must not be reset by creating this clean snapshot. Never enable
development authentication online. The hosted core walkthrough and restart
persistence checks passed; this is not production certification.

## Provenance and publication

The base includes preexisting components imported on 11 October and work
before kickoff on 12 October. Subsequent runtime/AMD and graph increments were
developed on 12–14 October. This is not a claim that the whole product was
created during the event. See `PROVENANCE.json` for retained component hashes.
No private construction documents, roadmap, local logs, credentials, runtime
database or old Git history are included. Historical records remain private.
`SOURCE-INVENTORY.json` identifies this exact review snapshot. The MIT license covers the project implementation in this release. Third-party
dependencies retain their own licenses. Preexisting component reuse is disclosed;
event eligibility remains subject to organizer review.
