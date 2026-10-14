# DossierMind — ACT III competition prototype

Public competition source release. Project code is licensed under MIT.
Source repository: https://github.com/enrico-axiark/dossiermind-amd-act-iii
External deployment and online acceptance are still pending.
Only this prototype is in scope. It contains no production customer archive.
All supplied document examples are fabricated for testing and demonstration.

The application connects a synthetic private client or business and its
accountant: encrypted original files, parsing, sourced notes/wiki, a clickable
brain map, lexical retrieval, AMD Advisor, checklists, calculations and PDF
reports. AI outputs remain proposals; matching citations do not prove semantic
correctness or professional approval.

## Run locally

Use Node.js 24+, Python 3 and Poppler (`pdftoppm`). Install Python dependencies
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
`render.yaml` is a deployment candidate with a paid persistent disk, production
authentication and AMD disabled. It does not provision users or seed data.
Configure HTTPS OIDC/PKCE, explicitly map user subjects to demo tenants,
provide distinct 32-byte base64 server encryption/audit secrets and authorize
the inference budget before exposing the application. Never enable local
development authentication online. Existing call usage must not be reset by
creating this clean snapshot. External deployment acceptance is still pending.

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
