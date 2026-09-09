# Inksheaf publisher

The release candidate starts the free, private PDF when the creator submits their publication
and delivery email. `/edition` keeps their selected cover beside actual source readings,
set-aside reasons, contents, typesetting/review events and complete PDF links. Email delivery
uses the saved edition outbox automatically; its status and retry are separate from PDF creation.
There is no pre-PDF verification click. Ownership permission remains necessary before publishing.

This is the candidate for **draft PR #7, not deployed**. Production remains on its earlier
release. The full annual PDF acceptance is still held; this is not launch acceptance.
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
  has its own recorded reason. Chapter endings are not blanket exemptions.
- Compiled paragraph/figure positions catch floats interrupting a paragraph even when vision
  misses them. These measured findings hold delivery and can select a source-position repair.
- Review failures, truncated answers, invalid coverage, exhausted budgets or unresolved defects
  hold the completed delivery. Each distinct visual defect receives confirmation, including
  multiple defects on one page. Pagination findings receive both neighbouring pages; image/glyph
  findings receive actual source figures. Repaired PDFs cannot retain obsolete page rasters.

## Budget and persistence

`OPENROUTER_API_KEY` stays on the server. Strict JSON schema, provider privacy constraints and
per-token price ceilings accompany every publisher call. The reader is
`google/gemini-3.1-flash-lite`; the publisher is `anthropic/claude-sonnet-5`. No model substitution.

A persisted ledger reserves the conservative request ceiling **before** each paid request:
UTF-8 text byte bound, schema/framing allowance, full output ceiling and a bounded PNG allowance.
Actual usage reconciles it. An unknown charge retains its reservation. One transient retry is
allowed and charged to the same ledger. A failed review stops after that retry rather than
  accumulating unknown-charge reservations on later pages. Semantic/schema correction is also bounded.

One edition shares a $2 inference cap and 96-call ceiling across all volumes and retries. Calls
are serial. Each volume attempt shares six render passes across initial fitting and at most two
model repair rounds; unused passes can fit figure gaps exposed by a repair. The inference cap
persists across attempts. The existing URL-preview planner has its separate pre-existing quota.
A D1 revision compare-and-swap prevents two workers from independently resetting the budget.
Source/model results and actual progress survive worker restarts. Private journal content is
not exposed through the creator API or public Actions artifacts.

PDF creation costs the creator $0. The owner's pricing decision is a **$2 gross retail addition
per physical copy**, collected only on printing. `COMPUTE_POLICY` records that rule; Lulu retail
pricing/payee collection is still pending. Do not describe it as already collected or change it
to an upfront generation charge.

## Local checks and rehearsal

```sh
node scripts/test-publisher-agent.mjs
node scripts/test-publisher-workspace.mjs
node scripts/test-publisher-layout.mjs
node scripts/test-publish-volume.mjs
node scripts/test-page-review.mjs
node scripts/test-typst-fixtures.mjs
npm run build
node scripts/test-honesty.mjs --source-only
python3 validate.py
```

The current full unit suite and `npm run test:launch:ui` pass in Chromium/WebKit, including
2,112 cover-fit checks. Required `node scripts/test-renderer.mjs`: **69 passed**. Typst:
**35 passed**; page review: **29**; bounded layout: **13**; orchestration: **6**; release
compatibility: **4**. Build, source honesty and vault validator also pass. The earlier automatic
approval usage-limit rejection was resolved through a new scoped approval; the runner is available.

Actual paid rehearsal evidence is separate from tests with controlled model responses:
- The synthetic eight-source run completed with six retained pieces and 14 PDF pages. It predates
  the final source-image/neighbour-page refinements.
- An own-publication illustrated essay now completes after two model repair rounds and five
  renders: 18 pages, no unresolved visual or measured reading-order findings. Its first model
  pass missed a floating-image interruption; compiled paragraph/figure positions now catch it.
  The publisher applies source-position repairs and a short reference shares the edition note.
  Cumulative development spend is $0.293589 ($0.496861 including unknown-charge reservations).
  This targeted fixture is not annual-book, print-minimum, inbox or Lulu acceptance.
- The latest full annual trial retained 22 of 23 sources (36,001 words), rendered 150 pages and
  stopped at an invalid layout decision. A content finding cannot be dismissed as intentional
  space. Neighbour evidence and a source-position figure repair were added afterward. **The
  annual book remains held**; genuine stranded references/reading-order issues still need an
  accepted repair and recheck, alongside dismissal of unsupported model alarms.
- Two actual Opus frontend critiques completed ($0.11341 and $0.11007). They are design evidence,
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

Apply migrations 0010 (outbox) and 0011 (publisher state/events) through the protected GitHub
release path. No direct Cloudflare deployment. Each built artifact includes `inksheaf-press.json`
with its exact commit. Press jobs check out that deployed commit, so merging newer code alone
cannot start using callbacks that are not live. Before the first manifest release, only legacy
requests can fall back on the pinned `a560d91` press. New requests carry `publisher-v1` and hold
if compatible deployed code cannot be confirmed. Outages/malformed manifests never fall back.
This compatibility arrangement has local tests; production rollout remains untested.

Before release, finish real annual PDF acceptance and review the final candidate. Then use the
already existing owner reservation 15 to prove ordinary production dispatch, actual inbox delivery,
complete private PDF access and the operator copy. Do not repeat signup or order 22370559.

Still open: creator link renewal/retention, early set-aside restoration before a PDF exists,
rendered-page browsing while production runs, actual owner-export acceptance, durable revision
recovery, provider delivery webhooks, final wrap-cover assembly/acceptance, and the two Lulu
routes. Personal copies use an Inksheaf-hosted listing. Subscriber sales use the creator's own
Lulu account, optional markup and a verified purchase link for the native orange Substack button.
The workspace currently explains those routes; it does not automate a completed listing.
