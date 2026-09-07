# Inksheaf launch candidate — 2026-09-06

The delayed editor could reduce a 23-post archive to a 22-essay edition while the
description and accessible announcement kept old totals. The selected binding now
drives every edition total and the reservation snapshot, including changes made
while the editor is still reading. The two P1s are fixed locally; production has not
received this candidate.

The personalised book has a substantial desktop cover, a readable mobile archive
sampler, publication colours supplied by the API, and a keyboard-operated cover.
Pricing and reservation sit beside the book before binding details. The hero now has
one continuous opening against a fixed photographic desk, with a separate portrait
composition that keeps the engraving visible. A short scroll triggers the completed
800 ms opening; the header action immediately focuses the settled title-page field.
The personal book opens only on deliberate click, tap or keyboard input. Loading and
errors preserve the field position; compact typing has a usable paper surface. The
existing font is served locally and the result and price appear without a fixed pause.

## Try the candidate

In `/Users/caithrinrintoul/repos/inksheaf-astra-2026-09-06`:

```sh
npm run build
npm run review:launch
```

Open <http://127.0.0.1:8807/> and enter `caithrin.com`. A server was left running on
that port at handoff; restart only if it is unavailable. This is a fixed sample
archive and a synthesized editor-exclusion result, clearly labelled on the page.
Every API effect is simulated. Other publication URLs show an explanatory error.

1. Use the header action or scroll through the book story; submit the publication.
2. Watch the calendar edition update to the editor's 22 essays / 163 pages.
3. Open the cover. Recent titles are labelled as an archive sampler; final contents
   belong to the proof. The excluded post may appear in this sampler by design.
4. Try Half-year and Quarterly, keyboard arrows/Home/End, and both interiors.
5. Open the reservation and submit any example address. This demo creates nothing
   and returns the test acknowledgement. Feedback is also explicitly not saved.

## Evidence

- Production build: pass; validator: 13; source honesty: 47; hero assets: 36.
- `npm run test:launch:ui`: seven motion journeys, four edition configurations, 16 edge
  journeys, and full scroll/CTA/loading/error/reduced-motion acceptance pass.
- WebKit: seven motion journeys and four edition configurations pass. Compact typing
  checks include full form bounds, preserved focus, a clickable action and axe.
  The handoff also checks actual painted paper pixels to catch a blank image frame.
  The design matrix has six clean states, 30 screenshots and zero WCAG violations.
- Full preview unit chain and print-renderer acceptance (69) passed on the preceding
  candidate. This motion pass changes neither the backend nor the print renderer.
- Local review server smoke: preview → delayed editor → simulated reservation,
  with no external requests or browser errors.

Screenshots, before evidence, videos and logs are under `output/playwright/`; see
`NIGHTLOG.md` for exact folders. The latest MP4s in `motion-review/` show desktop and
mobile opening, preview reveal and cover interaction. `final-motion/` records the
preceding candidate. Browser evidence is local and ignored
by Git. The release workflow will upload acceptance evidence when run in GitHub.

The initial preferred poster is 30 kB desktop / 48 kB portrait. Both preferred posters
plus the opening total 604 kB / 850 kB respectively; the browser selects one composition.
Each sequence has 24 frames, lasts 799 ms and plays once. Reduced motion avoids the
animation download. The exact prompts, saved master paths and offline rebuild recipe
are in `scripts/motion/asset-prompts.md` and `scripts/motion/README.md`.

## Still required before calling launch acceptance complete

- Live preview-only email check in an ordinary browser and confirmation of the owner
  alert in the inbox. It was not attempted in this unattended run. No mailbox connector
  or approved normal browser session was used; automation suppresses this alert.
- Explicit confirmation of the chosen publication/address for one real reservation
  and ownership verification. Confirm all three owner messages share one funnel ID,
  and record whether the proof was queued or dispatched. A pending question proposed
  caithrin.com and caithrin@caithrin.com; no answer was received during this run.
- Physical iPhone/software keyboard and VoiceOver review. Local WebKit and axe do not
  prove these human checks, nor do fixtures prove live OpenRouter/editor behavior.
- Review and authorize the branch push/merge. Let GitHub's checks run on Linux/Node 22;
  this run used macOS/Node 26. The new browser step has not yet executed in GitHub.
- Release through manual `workflow_dispatch`, allowed `PROJECT_STATUS`, and Caithrin's
  protected `production` approval. Preserve the artifact digest and migration gates.
  Never use direct Cloudflare deployment. Recheck the real publication on the released
  SHA before closing the P1s in the production audit.

No backend, migration, print renderer, credential or production configuration was changed.
Two built-in image-generation edits supplied fixed desk plates; Blender rendered the
book and opening locally. No OpenRouter calls or image/video API credentials were used.
The local preview and proof checks do not establish the live email system's delivery.
