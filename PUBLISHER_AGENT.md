# Inksheaf publisher

The release candidate starts the free, private PDF when the creator submits their publication
and delivery email. `/edition` keeps their selected cover beside actual source readings,
set-aside reasons, contents, typesetting/review events and complete PDF links. Email delivery
uses the saved edition outbox automatically; its status and retry are separate from PDF creation.
There is no pre-PDF verification click. Ownership permission remains necessary before publishing.

The owner authorized releasing PR #7 on September 10 and continuing the build. Production
remains on its earlier release until the protected GitHub deployment completes. The full
annual PDF acceptance is still held; permission to release the application does not clear
those PDF findings or establish public-launch acceptance.
The current evidence and remaining gates are in `evidence/publisher-agent-2026-09-08/` and the
vault's `publisher-agent-design-2026-09-08.md`.

## Editorial and page work

- `scripts/lib/publisher-agent.mjs`: full normalized source bodies in batches of six;
  Gemini 3.1 Flash Lite classifies and cites existing source lines. Only housekeeping may be
  automatically set aside. Poems, recipes, interviews, image-only and uncertain work remain.
  A substantial essay ending in thanks must remain. Creator overrides take precedence.
- Claude Sonnet 5 arranges the included IDs into source-backed sections. IDs must occur exactly
  once; chronology is validated within each section. The renderer supplies the actual folios.
- `publish-volume.mjs` is shared by the press and local rehearsals. It builds with the existing
  deterministic fit loop, reviews every PDF page, reviews every measurement above 30% unused
  body space, and allows two rounds of measured repairs followed by another review.
- Models may select only measured figure heights, bounded leading, collected references, or
  keeping a measured floating image at its original source position between paragraphs.
  They cannot remove writing, shrink the font or invent a typesetter operation. Source hashes
  must remain identical during repair. A content/overflow finding cannot be excused as space.
- Renderer context distinguishes physical PDF leaves, printed folios, blank front-matter versos,
  complete single-page pieces, article tails and section dividers. Every whitespace exception
  has its own recorded reason. Section dividers and their opening essays start on rectos; blank boundary versos carry no running head or folio. Chapter endings are not blanket exemptions.
- The geometry audit sums unused vertical intervals on every page, bridging normal leading. Several smaller gaps cannot evade the 30% check. The renderer also retains its raster gap measurements for fitting.
- Compiled paragraph/figure positions catch floats interrupting a paragraph even when vision
  misses them. These measured findings hold delivery and can select a source-position repair.
- Review failures, truncated answers, invalid coverage, exhausted budgets or unresolved defects
  hold the completed delivery. Each distinct visual defect receives confirmation, including
  multiple defects on one page. Pagination findings receive both neighbouring pages; image/glyph
  findings receive actual source figures. The reviewer checks alternating publication/essay heads
  against the intended label and compares screenshot lettering with its source bitmap. Repaired
  PDFs cannot retain obsolete page rasters. A mixture of repairs and holds uses available bounded
  repairs first, then rechecks every page; persistent findings still block delivery.

## Creator corrections during production

Before the first completed version exists, each publisher exclusion offers **Put this back in
the book** in the private workspace. The choice is saved immediately, survives a reload, and
updates the included count. The old contents remain unavailable until their corrected version
arrives. Expanded pieces stay open across the worker restart. The creator’s “Kept by you”
status retains the original model reason and source quote for inspection.

Migration **0012** stores selection revisions separately from the inference journal. Only an
actual exclusion from this edition may be restored; earlier reading events remain valid while
a restart replays its identity and contents. Concurrent/repeated restores merge without duplicate
revisions. The worker checks saved choices between editorial/review calls and rebuilds from its
existing reading cache and budget. At most four selection attempts run in one worker; continued
changes are saved for recovery rather than resetting its $2 cap.

A SQLite constraint at version insertion prevents a stale selection from becoming a completed
PDF. Progress from that stale selection cannot replace the current workspace. If completion
wins the race, the saved PDF remains available and the late correction uses **Adjust this
edition**. This adds no verification click, extra author email or duplicate press dispatch.
A stopped/failed worker still needs recovery: saving a correction alone does not launch a new
worker. Automatic recovery of that state remains part of the launch work.

The production press now preserves `inFlow` repairs between builds and installs the same
PyMuPDF whitespace dependency already used by acceptance checks. These changes are candidate
code; no press job or production migration was run as part of this checkpoint.

## Read the pages while the publisher works

The candidate now extracts up to six unchanged leaves from each actual typeset PDF, including
contents, opening writing and available illustrated pages. A **Pages** view opens into the writing.
It presents the printed leaf or readable text, with actual printed folios separated from preview
positions. Recognized prose reflows; poems, recipes and unclassified writing preserve line breaks.
The selected cover remains visible. On a phone it tightens while reading, and the existing email
and private return controls move below the reader. Layout explanations are reachable from revised
pages. The interface distinguishes these early drafts from the later complete PDF.

`publish-volume.mjs` calls the optional preview hook after typesetting and after each changed
layout, before visual review. Production uploads only a small private excerpt at this stage. A
preview extraction/upload failure leaves complete-book checks running. A stale-selection or
journal failure still reaches the orchestrator. Local rehearsals have no upload hook by default.
No proof upload was performed during this implementation.

Signed publisher events bind each snapshot to its selection, worker run, volume and exact PDF
hash. The creator API supplies a same-origin URL and withholds the upstream capability. The read
endpoint verifies the edition capability, current run/revision/latest snapshot, fixed upstream,
expiry, byte limit and digest. It rechecks current selection/run/pages after fetching. Retired
previews cannot be reopened. Private/no-store/noindex headers accompany the response. This uses
the existing PDF store API; no new Modal endpoint or service deployment is required.

PDF.js **6.3.289** loads only when reading begins, with a local worker, character maps, fonts and
image decoders. No CDN receives a private URL. One document/worker/render is active at a time;
selection changes cancel and clear old content. Dependency audit also led to the existing
Astro/Sharp/js-yaml patch updates: **7.2.8 / 0.35.4 / 4.3.2**. Current npm audit is clean. Node's
minimum is 22.13. Final validation and evidence are recorded alongside this checkpoint.

Thirteen private-preview checks pass, including real extraction, actual SQLite, wrong-edition
access, stale-run/selection races during fetch, malformed/oversized/changed bytes, and print-text
preservation. A local extraction of the held 152-page owner PDF produced five leaves; all five
exactly match the corresponding source-page text. That is extraction evidence, not annual
acceptance. Chromium/WebKit phone/desktop checks use a real three-leaf synthetic Typst PDF with
intercepted APIs. The actual $0.08611 Opus critique and its disposition are separate artifacts.
The full local unit suite passed before the subsequent brand steering; affected watermark,
Typst, layout and orchestration checks pass afterward. Required renderer 69 passes. Final
full browser acceptance passes, including 2,112 cover-fit checks. After the final critique,
focused reader checks pass again; 12 light/dark Chromium/WebKit combinations verify masthead
clearance at 320/390/1280 widths and gradient removal for increased contrast, forced colours
and print. The required renderer gate passes again after the final watermark adjustment.

Preview renewal/retention still needs the broader private-file continuity work. A draft excerpt
is not an accessible tagged full-book reader: text extraction retains running heads/folios and
unclassified layouts' line breaks. The printed-page view preserves the actual original layout.

## Brand prominence — September 9 owner steering

The owner asked for a more prominent accepted logo, opening/closing-page watermarks and a
very subtle gradient. The working placement is printed opening/closing matter, with the
gradient on screen panels. The workspace mark is now 288px on desktop and responds to phone
width (166–180px); the homepage and workflow marks are enlarged within their current layouts.
The homepage edition title is promoted so the creator remains the subject of the workspace.

The watermark preserves the exact SVG paths in #EDEEEB at 3.6in wide, with 1.05in bottom
clearance. Typst places it only on the
opening half-title and closing matter, above the folio. Metadata identifies those leaves to
the reviewer and private preview selector. No new page or source-text change is needed. A
real nine-page PDF comparison changes only the first/last rasters; every word, page count and
body-page raster matches. Six watermark checks and the existing 42 Typst checks pass. This
is a synthetic specimen, not the annual book's acceptance or physical proof approval.

The screen panel gradient is restrained to a few channel values, with corresponding dark
and increased-contrast handling. It does not tint the real PDF canvas. The latest owner
request extends the earlier back-cover-imprint-only identity rule; publication cover/spine
artwork is still the creator's. The final brand critique and browser captures are recorded
separately. Current code remains a draft candidate.

## Budget and persistence

`OPENROUTER_API_KEY` stays on the server. Strict JSON schema, provider privacy constraints and
per-token price ceilings accompany every publisher call. The reader is
`google/gemini-3.1-flash-lite`; the publisher is `anthropic/claude-sonnet-5`. No model substitution.

A persisted ledger reserves the conservative request ceiling **before** each paid request:
UTF-8 text byte bound, schema/framing allowance, full output ceiling and a bounded PNG allowance.
Actual usage reconciles it. An unknown charge retains its reservation. One transient retry is
allowed and charged to the same ledger. A failed review stops after that retry rather than
accumulating unknown-charge reservations on later pages. Semantic/schema correction is also bounded.

One edition shares a $2 inference cap and 256-call ceiling across all volumes and retries. Calls
are serial. Each volume attempt shares six render passes across initial fitting and at most two
model repair rounds; unused passes can fit figure gaps exposed by a repair. The inference cap
persists across attempts. The existing URL-preview planner has its separate pre-existing quota.
A D1 revision compare-and-swap prevents two workers from independently resetting the budget.
The former 96-call ceiling could not fit three scans of a 150-page book (114 sheet calls alone). The shared 256-call limit allows that review while the $2 cap, previous reservations and repair limits remain unchanged. Source/model results and actual progress survive worker restarts. Private journal content is
not exposed through the creator API or public Actions artifacts.

PDF creation costs the creator $0. The owner's pricing decision is a **$2 gross retail addition
per physical copy**, collected only on printing. `COMPUTE_POLICY` records that rule; Lulu retail
pricing/payee collection is still pending. Do not describe it as already collected or change it
to an upfront generation charge.

## Local checks and rehearsal

```sh
node scripts/test-publisher-agent.mjs
node scripts/test-publisher-workspace.mjs
node scripts/test-publisher-restore.mjs
node scripts/test-publisher-layout.mjs
node scripts/test-publish-volume.mjs
node scripts/test-page-review.mjs
node scripts/test-typst-fixtures.mjs
npm run build
node scripts/test-honesty.mjs --source-only
python3 validate.py
```

The full local unit suite now passes with **11 restoration checks**, including actual SQLite
version races and the real publisher session reusing its reading cache and ledger. Other affected
checks pass: workspace **8**, publisher **24**, version **7**; required renderer **69**, Typst **42**,
page review **31**, bounded layout **15**, orchestration **8**, and release compatibility **4**.
Build, source honesty **48**, and vault validator **13** pass. The final Chromium/WebKit phone and desktop restoration checks and refreshed captures also
pass after the critique fixes, including the preserved original explanation and source quote.

GitHub acceptance **34389625351** passed on the previous `2f62191` candidate, including the full
browser suite and 2,112 cover-fit checks. Restoration acceptance **34393762938** passed on
`8fc50c1`. Page-reader acceptance **34399306635** failed in the watermark test: the CI PDF
library's deprecated `fitz` alias printed a warning into JSON output. The test now uses the
supported `pymupdf` import; fresh GitHub acceptance is required. No browser/profile changes
are part of this PR.

Actual paid rehearsal evidence is separate from tests with controlled model responses:
- The synthetic eight-source run completed with six retained pieces and 14 PDF pages. It predates
  the final source-image/neighbour-page refinements.
- An own-publication illustrated essay now completes after two model repair rounds and five
  renders: 18 pages, no unresolved visual or measured reading-order findings. Its first model
  pass missed a floating-image interruption; compiled paragraph/figure positions now catch it.
  The publisher applies source-position repairs and a short reference shares the edition note.
  Cumulative development spend is $0.293589 ($0.496861 including unknown-charge reservations).
  This targeted fixture is not annual-book, print-minimum, inbox or Lulu acceptance.
- The September 9 annual trial retained 22 of 23 sources (36,001 words) and rendered **152 pages**.
  All source hashes match. All physical leaves and printed folios have matching parity; the first
  essay starts on physical page 9 / folio 1. Every page has a complete whitespace measurement;
  **29 pages exceed 30%** and still require accepted reasons or repairs. The paid scan confirmed
  six visual findings; geometry independently found 20 floating-image paragraph interruptions.
  A layout decision tried to excuse the screenshot glyph finding as whitespace and validation
  held the book. Inspection of the original screenshot establishes that those broken letters
  were already present; the publication head is also intentional. Review-context fixes followed.
  Small chart/map/feed labels and source-position repairs remain unresolved. **The annual book
  remains held**; no full real-model acceptance is claimed for the newer corrections.
  The cumulative annual ledger is $0.78252025 known / $1.20392225 including unknown reservations.
- Five actual Opus frontend critiques completed ($0.11341, $0.11007, $0.08192, $0.08611 and $0.08749). They are design evidence,
  not browser verification or approval. See the saved decisions on their recommendations.

To make explicit paid model calls against synthetic text, using the actual complete local path:

```sh
node scripts/rehearse-publisher-book.mjs \
  --fixture scripts/fixtures/publisher-posts.json \
  --out proofs/publisher/my-rehearsal --live
```

The command reads `OPENROUTER_API_KEY` or the existing local OpenRouter credential. It uses no
email, proof upload, dispatch, listing or order capability. `--resume` preserves the prior result
and reuses the same spend/cache state. Count the cumulative journal once, not every resume file.
An authorized cached own-publication fixture can add `--host` and `--brand-file`. Private fixtures,
PDFs, model journals and browser masters remain in ignored output directories.

## Release and remaining work

Apply migrations 0010 (outbox), 0011 (publisher state/events), and 0012 (creator selection) through the protected GitHub
release path. No direct Cloudflare deployment. Each built artifact includes `inksheaf-press.json`
with its exact commit. Press jobs check out that deployed commit, so merging newer code alone
cannot start using callbacks that are not live. Before the first manifest release, only legacy
requests can fall back on the pinned `a560d91` press. New requests carry `publisher-v1` and hold
if compatible deployed code cannot be confirmed. Outages/malformed manifests never fall back.
This compatibility arrangement has local tests; production rollout remains untested.

Release authorization was given on September 10. Preserve the protected GitHub path and pass
the candidate checks before deploying. Continue real annual PDF acceptance separately; the
publisher must still hold unresolved books. Use the already existing owner reservation 15
for later production dispatch, actual inbox delivery, complete private PDF access and the
operator copy. Do not repeat signup or order 22370559.

Still open: creator link renewal/retention, automatic recovery of stopped workers,
actual owner-export acceptance, durable revision
recovery, provider delivery webhooks, final wrap-cover assembly/acceptance, and the two Lulu
routes. Personal copies use an Inksheaf-hosted listing. Subscriber sales use the creator's own
Lulu account, optional markup and a verified purchase link for the native orange Substack button.
The workspace currently explains those routes; it does not automate a completed listing.
