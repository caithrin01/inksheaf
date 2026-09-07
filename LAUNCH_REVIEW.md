# Inksheaf — integrated overhead candidate, September 7

The working site now has an overhead desk with a directly usable publication field, four cover designs and a paginated reader for real public text. The old angled scroll-to-open experience is no longer mounted. Publication names, their own logos and current cover colours drive the preview. The selected cover and palette survive reservation and enter the actual proof and print-cover generators.

## Review it

The server at **http://127.0.0.1:8810/** reads real public archives through the local API handlers. Try caithrin.com or the original reported case, manifund.substack.com. Every reservation, event, verification and email effect is simulated. It uses an in-memory cache, not D1.

```sh
npm run build
INKSHEAF_REVIEW_PORT=8810 INKSHEAF_REVIEW_PUBLIC_READS=1 npm run review:launch
```

The fixed local sample remains available at port 8809 (start `INKSHEAF_REVIEW_PORT=8809 npm run review:launch`). It uses the synthesized delayed-editor exclusion case and an actual excerpt from the owner's writing. The older `/design-study/` route remains historical and is not the implementation.

## What changed

- The cover, reading controls, edition copy and reservation form are connected in the working page. The cover picker uses a single selected state; the reader has explicit page controls, keyboard access, an enlarged view and actual-size reading.
- `functions/lib/book-design.js` and `public/book/cover.css` define the same cover faces for web and print. Version/palette are preserved in `plan_json.design`; invalid or truncated plans are rejected instead of silently losing the choice. Existing reservations without a design keep their historical print style.
- `functions/lib/book-interior.js` is shared with the real Paged.js proof renderer. The reader shows **recent public text**, not a claim that those paragraphs are selected for the displayed annual edition. The complete proof supplies images, notes, final contents and pagination. Paywalled posts are not sampled.
- Identity resolution uses verified publication metadata. It no longer guesses author bylines for print mastheads either. Schema 9 replaces old cached names/colours and adds bounded sample post references. The entered alias and canonical host share the preview cache.
- The publication's current Substack cover background takes priority over legacy accent fields. Print logos are embedded before rendering; a declared logo that cannot be fetched fails the proof instead of printing a broken image. QR codes retain a white quiet zone on dark covers.
- The existing selected-edition truth/accessibility repairs remain. Owner verification still precedes press dispatch. Printing another person's publication is not a product feature.

## Verification and its limits

Local build and Cloudflare Functions compilation pass. The full unit chain passes, including 13 new public-sample/design checks. The print renderer gate passes all 69 checks. All four new cover wraps were rendered as one-page PDFs at 903×666 pt with the original logo and no face overflow; rasterized PDFs were inspected. A new-design proof fixture rendered as 12 pages.

The release browser gate passes: four overhead/reader journeys in Chromium and WebKit, four edition configurations, four painted-cover/identity cases and 16 edge journeys. This includes real text painting, page turns, actual size, focus restoration, rejected unauthenticated reader messages, long titles, reduced motion, no-JavaScript contact, loading/failure and selected-edition preservation. Escape and Tab also work when focus is inside the enlarged sample iframe, verified in all four reader cases. Axe reports no WCAG A/AA violations in the tested states. The old opening-animation assertions were replaced by acceptance for the new interaction. GitHub now installs WebKit as well as Chromium, and PRs run checks without entering release jobs.

Two real public-GET journeys through the local handlers confirmed caithrin and **The Fox Says**, with their original logos, current colours and real excerpts. The complete browser UI also passed those real-public-data reads. These are not Cloudflare edge or inbox-delivery tests.

The first PR run passed the unit chain but exposed a CI wiring error: the pre-release honesty gate fetched the older production page and compared it with this candidate's source. It now runs after the build with `--source-only`, against the artifact under review. The separate live honesty command remains available for post-release acceptance; signup checks already run in the full unit chain.

Opus completed a new six-image critique via the runnable OpenRouter workflow ($0.07576). It judged the overhead direction credible enough to carry forward and identified control hierarchy/selection ambiguity. Its "stale selection ring" was the Classic cover's printed frame, not stale application state; that visual ambiguity was removed. See `evidence/frontend-review/2026-09-07-integrated-opus/`. The response is critique, not design or launch approval.

Durable checks: `evidence/frontend-review/integrated/`. Full screenshots: `output/playwright/public-integration/`, `output/playwright/launch/`. PDFs: `output/pdf/integrated/`. Masters remain local; reproducible sources and compact evidence are committed.

## Remaining launch acceptance

Real inbox delivery is still unverified. Complete the preview-only owner-alert check, then the specifically approved reservation/verification journey. Physical iPhone keyboard/VoiceOver and an actual physical proof remain human checks. A browser sample cannot certify paper, binding, colour reproduction or final print pagination.

Nothing in this work deploys directly to Cloudflare. Production still requires the existing manual GitHub workflow, PROJECT_STATUS policy, protected production approval, artifact digest and migration gates. No production database, reservation, email, order or verification was created by this run.
