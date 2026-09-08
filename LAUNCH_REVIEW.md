# Inksheaf — approved design implemented, September 7

The owner approved the independent-editions style guide and requested implementation. The working site now carries that identity, four native 6×9 cover designs, restrained paper cues, real publication previews and the subscriber print-button story. The owner requested production release after reviewing the implementation; GitHub release is in progress.

## Review it

**http://127.0.0.1:8841/** reads real public archives through the local handlers, with an in-memory cache. Try caithrin.com or the reported naming case, manifund.substack.com. Reservation, verification, email and order effects are simulated.

```sh
npm run build
INKSHEAF_REVIEW_PORT=8841 INKSHEAF_REVIEW_PUBLIC_READS=1 npm run review:launch
```

The deterministic fixture review is at **http://127.0.0.1:8840/** (`INKSHEAF_REVIEW_PORT=8840 npm run review:launch`). The accepted standalone guide remains at **http://127.0.0.1:8830/**, sourced from `design/style-guide/` and excluded from the Astro release artifact.

## What changed

- Approved outlined wordmark, favicon, self-hosted Inter/Source Serif typography and a matching 1200×630 social image. The same identity reaches the reader, edition changes, mailing and error pages.
- An immediately usable publication field; two overhead books on desktop and one larger book on phones. No scroll-to-open gate, 3D flip or custom cursor.
- The core distribution story directly below the opening: a sample newsletter with Substack's signature-orange print button linking to the existing caithrin Lulu edition. The writer adds their edition link to a post; readers buy directly from the printer.
- Four connected cover compositions, real text excerpts, explicit print-page controls, enlarged/actual-size reading and preserved selected-edition truth. Repeated preview recommendations and the redundant single-volume shelf were removed.
- Actual print-file interior spread, eleven FAQs and connected reservation/feedback surfaces. Copy keeps the own-publication-only scope, explains proof approval and avoids unsupported payouts or calendar delivery promises.

New saved choices use **design version 2**. `functions/lib/book-design.js` and `public/book/cover.css` share the screen/proof/wrap geometry. Version-1 snapshots delegate to the committed historic `book-design-v1.js`/`cover-v1.css`; reservations without a saved design retain their previous print path.

The canonical caithrin transparent marks are used only for verified caithrin hosts, in charcoal on light covers and gold on dark covers. Other publications keep their original logo. Uniform opaque edge colours can become a continuous band, saved with the design snapshot. Complex images and CORS-unreadable sources remain intact. Print embeds original assets and still fails if a declared logo cannot be embedded. Long titles, unbroken names, CJK and Arabic cases are included in cover-fit checks.

## Verification

- Astro build, full preview/backend unit chain, 48 source-honesty checks and project validator (13 pass, zero warnings/failures).
- Full release browser gate: four overhead journeys, four edition configurations, four painted publication-cover cases and sixteen edge journeys passed. Includes keyboard/focus restoration, actual-size reading, unauthenticated reader message refusal, stale/failed previews, no-JavaScript fallback and saved selections.
- New site matrix: Chromium/WebKit × desktop/phone × light/dark, eight passing cases and zero axe WCAG A/AA violations in tested states.
- Supporting edition/mailing forms: the same eight configurations, payload preservation and simulated sends; zero axe A/AA violations. `test-site-workflows.mjs` is included in `test:launch:ui`.
- 360 cover-fit cases: two engines, three widths, four designs, five title cases and three logo modes.
- Required renderer gate: **69 pass, 0 fail**. Four print wraps render as one page each at 903×666 pt, with original logos painted and no face overflow.
- Complete version-2 synthetic letters fixture: **14-page PDF**, six articles and matching contents; proof lint clean. It exercises the canonical owner logo and does not represent an approved real edition.
- Real public reads confirmed **caithrin** and **The Fox Says**, their logos and actual public excerpts through the local handlers. No production reservation was submitted.

Useful commands:

```sh
npm run test:launch:ui
npm run test:preview:unit
node scripts/test-cover-fit-v2.mjs
node scripts/test-renderer.mjs
npm run test:print:designs
node scripts/test-honesty.mjs --source-only
python3 validate.py
```

The print-fixture command uses `--brand-file` (the wrap command instead uses `--brand`):

```sh
node scripts/build-book.mjs https://caithrin.com --fixture proofs/letters-fixture.json --brand-file output/pdf/integrated/brand.json --design-file output/pdf/integrated/design.json --out output/site-integration/v2-proof.html
node scripts/render-book.mjs output/site-integration/v2-proof.html output/site-integration/v2-proof.pdf
node scripts/proof-lint.mjs output/site-integration/v2-proof.html
```

## Actual external review and evidence

A seven-image OpenRouter `anthropic/claude-opus-5` critique completed (9,950 input / 1,585 output tokens, reported cost $0.089375). It found the system coherent and the subscriber mechanism clear. Its phone-scale and preview-repetition observations were applied. Its gallery-clipping observation came from a tight locator screenshot; final full-width captures show the intact page margins and CTA. Final refinements were browser-checked after the call. This is critique, not owner acceptance or launch approval.

- Actual model response, run metadata, image hashes and disposition: `evidence/frontend-review/2026-09-07-site-integration/`.
- Compact checks: `evidence/frontend-review/site-implementation/`.
- Full screenshots: `output/playwright/site-design/`, `site-public/`, `site-workflows/`, `launch/`.
- PDFs: `output/pdf/integrated/`, `output/site-integration/v2-proof.pdf`.
- Initial dirty-file backup: `output/site-integration/before/`.
- Vault pickup and permanent screenshots: `05-Projects/Substack Magazine/site-implementation-2026-09-07.md`.

## Live sample correction

The design release `4f09178` completed in GitHub run `34174900620`. Post-release checks passed the asset hashes, publication previews and 84 live honesty/API assertions, but exposed a direct-only sample request that failed from Cloudflare for relay-served publications.

The correction adds a separate public-sample endpoint to the existing authenticated Modal relay. Requests are signed for the exact cached host, slug, post ID and a five-minute time bucket. Both relay and Pages Function revalidate the public post identity and audience. The existing excerpt sanitizer, 2 MB limit, two-candidate bound and fresh-preview requirement remain. Known relay-served archives immediately use their working route; direct archives can fall back within the reader's time budget. Archive reads are unchanged.

The same live check found a missing owner logo: the archive relay omitted `logo_url` from verified publication metadata when the homepage read failed. That field now survives the relay; preview schema 10 and relay result schema 2 invalidate incomplete cached identity.

Targeted validation: 22 sample/design assertions, eight relay tests and 21 archive-paging checks. GitHub runs these in its complete unit chain. The new Modal endpoint must be deployed and checked before the protected Cloudflare API release. Final live-reader verification and release records are saved in the vault implementation note.

## Release status

The owner explicitly requested “push it to inksheaf.com” after reviewing the implemented design. The approved source, assets, guide and evidence are staged for the existing PR. Earlier local experiments remain outside this release. Merge follows green GitHub checks; production follows the existing manual workflow and protected-environment review. Final run and deployed commit are recorded in the vault implementation note.

Real inbox delivery, the specifically approved reservation/verification journey, physical-device assistive-technology checks and a physical proof remain distinct launch acceptance. Browser and PDF tests do not certify paper, binding or colour reproduction. Local public reads are not Cloudflare edge tests.

The existing GitHub workflow, protected production approval, PROJECT_STATUS policy, artifact digest and migration gates are unchanged. Do not deploy directly to Cloudflare. No production database, reservation, email, verification or order was created by this implementation run.
