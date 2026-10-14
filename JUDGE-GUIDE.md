# DossierMind: reviewer walkthrough

Demo: https://dossiermind-amd-act-iii.onrender.com/app/

This is a competition prototype with fabricated documents and identities. Login
passwords are supplied privately to intended reviewers; neither passwords nor the
AMD API key are published in this repository. Three demonstration profiles are
available: business client, private client and accountant. Clients see their own
archive; the accountant can work with both clients. These are shared demonstration
profiles, so edits may be visible to another reviewer using the same profile.

## Suggested walkthrough

1. Log in as the business client. Open the archive and select the prepared
   synthetic documents. The business and private archives each contain 11 original
   files, including PDF, spreadsheet, CSV, XML, email and scanned material.
2. Open `Cervello`. Explore the clickable brain-shaped map, select a document node
   and inspect its original source. Source references link extracted passages to
   their document, page, row or cell where supported by the parser.
3. Open the synthetic service contract. Request an AMD wiki proposal, then follow
   its quotations back to the original. A model proposal is not human approval;
   rejected or unsupported material is not promoted to verified evidence.
4. Open the scanned receipt and request visual processing. Compare the returned
   transcription with the original page. Visual transcription can be wrong and
   does not establish payment or tax treatment.
5. In Advisor, ask: “Quali importi mensili sono indicati nel contratto per Cloud A e
   Newsletter B? Cita i passaggi originali e indica quali condizioni di Newsletter
   B non sono presenti. Non proporre calcoli o risparmi.” Follow any quotations
   back to the documents. Broad advice requests can legitimately return
   insufficient evidence; this is displayed rather than replaced by invented facts.
6. Log in as the accountant. Select the same business archive, add a sourced note
   and inspect its attribution in the brain map. The client can see that shared
   contribution. Do not approve proposals unless you actually review them.
7. Export a document dossier or an Advisor draft PDF. Inspect the source references
   and review limitations. A draft export is not professional certification.
8. Switch to the private client to inspect the separate archive, then log out.

## AMD and prototype boundaries

AMD inference runs on the server through the configured TokenFactory-compatible
endpoint, using `DeepSeek-V4-Flash-Vision-Exp`. API keys never belong in browser
code. The hosted deployment has an authorized cumulative allowance of 1,000 AMD
dispatches, shared by the demonstration profiles. Failures and uncertain dispatches
also count; restarting the service does not reset this allowance. Local historical
usage is separate. No claim is made that the underlying hardware or model weights
were independently verified.

The demo is not a production accounting service. Retrieval is bounded and lexical;
it does not prove complete archive coverage or semantic correctness. Notes, wiki
proposals and conditional calculations are not independent original evidence.
Email delivery and unavailable sharing controls are outside the demonstrated flow.

See `PROVENANCE.json` for disclosed preexisting components and `README.md` for
reproduction instructions. Hosted acceptance is still in progress; this walkthrough
is not a claim that every step has passed final qualification.
