# Hosted core walkthrough — 14 October 2026

Application: https://dossiermind-amd-act-iii.onrender.com/app/

The public deployment at commit `a5a123e` passed these checks using only the
fabricated competition profiles and original synthetic documents:

- Business and private clients each see one separate client archive; the accountant
  sees both. Cross-client reads, anonymous access, missing CSRF tokens and demo
  attempts to use administrative operations are rejected.
- All 22 original downloads match their published fixture SHA-256 hashes.
- Actual AMD inference generated a contract wiki with five sourced facts and a
  scanned PDF transcription with eight visual blocks. Its original normalized
  page is available for comparison. Neither proposal has been human-approved.
- Advisor answered a factual contract question with three original quotations.
  Two broader requests returned explicit insufficient-evidence abstentions. This
  does not establish the correctness of general recommendations.
- An attributed accountant note is visible to the client and represented in the
  brain graph. The public UI shows 21 contents and supports selecting the wiki node.
- A two-page document dossier and a one-page Advisor analysis export as valid PDFs.
  All three pages were rendered and visually inspected for clipping and overlap.
- Logout invalidates each tested profile's previous session cookie.
- After deployment/restart, the document archive, wiki, visual proposal, sourced
  note, three Advisor quotations and graph remain available. The stored Advisor
  PDF remains byte-identical. This persistence check made no new AMD calls.

These are core walkthrough checks, not a claim that every possible feature or
input is covered. AI relevance, document truth, professional correctness and
underlying AMD hardware/model weights have not been independently verified.
No human approval was recorded by the automated test.

The local full suite previously completed with 141 passing tests and one failure
because the Mac lacked `pdftoppm`. Hosted scanned-PDF processing subsequently
succeeded with the container's renderer. After the Advisor query-bounding change,
all 22 targeted Advisor regression tests passed. The local full suite result must
not be described as entirely passing.

Remaining submission work includes the final pitch PDF, cover and video, private
reviewer access instructions, and completion of the submission form. Preexisting
component reuse remains disclosed and subject to organizer eligibility review.
