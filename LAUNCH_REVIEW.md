# Inksheaf launch candidate — 2026-09-06

The delayed editor could reduce a 23-post archive to a 22-essay edition while the
description and accessible announcement kept old totals. The selected binding now
drives every edition total and the reservation snapshot, including changes made
while the editor is still reading. The two P1s are fixed locally; production has not
received this candidate.

The personalised book has a substantial desktop cover, a readable mobile archive
sampler, publication colours supplied by the API, and a keyboard-operated cover.
Pricing and reservation sit beside the book before binding details. The existing
four-render hero remains, with more usable title-page controls and visible loading
without a fixed pause after the response. The existing font is served locally.

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

- `npm run test:preview:unit`: pass; renderer acceptance: 69 pass.
- Production build: pass; validator: 13; source honesty: 47; hero assets: 31.
- `npm run test:launch:ui`: four edition configurations, 16 edge journeys, and full
  scroll/CTA/loading/error/reduced-motion acceptance pass.
- WebKit edition journey: four configurations pass. Chromium and WebKit axe checks
  are clean. The design matrix has six clean states and 30 screenshots.
- Local review server smoke: preview → delayed editor → simulated reservation,
  with no external requests or browser errors.

Screenshots, before evidence, videos and logs are under `output/playwright/`; see
`NIGHTLOG.md` for exact folders. The MP4s in `final-motion/` show desktop and mobile
entrance, preview reveal and cover interaction. Browser evidence is local and ignored
by Git. The release workflow will upload acceptance evidence when run in GitHub.

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

No backend, migration, renderer, credential or production configuration was changed.
No additional OpenRouter integration or paid asset generation was needed. The local
preview and proof checks do not establish the live email system's delivery.
