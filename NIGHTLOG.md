# Inksheaf Astra launch pass — 2026-09-06

## Contract

Produce a beautiful, functional, reviewable local launch candidate from `0312f76`.
Workspace: `/Users/caithrinrintoul/repos/inksheaf-astra-2026-09-06`, branch
`codex/astra-launch-2026-09-06`. The original checkout stays available on main.

Allowed: scoped local edits, dependency installation, local browser journeys, builds,
tests, local checkpoint commits, and read-only public inspection. Preserve the GitHub
manual release and protected production approval. No push, deploy, remote database
mutation, production credentials, messages, paid model calls or authenticated browser
use without separate authorization. A pending question asks whether one real
reservation/verification journey is authorized. Local simulations cannot prove inbox
delivery. After three materially different safe attempts on a blocked lane, record it
and proceed to independent work.

## Direction

Visual thesis: a writer's own edition under warm lamplight, with substantial paper,
legible typography, and the restraint of a small press.

Content plan: retain the existing four-render hero; make the personalised edition and
its plan the reward; keep questions in the FAQ; finish with a clear reservation and
minimal footer. The latest hero storyboard supersedes older requests to rebuild a
CSS/WebGL hero. Use the publication's identity on its cover.

Interaction thesis: deliberate scroll dissolves; an immediately usable title-page
input; a restrained cover-to-contents reveal that is separately composed for mobile.
Keyboard, touch and reduced motion must reach the same useful states.

## Checkpoints

1. Read the handoff, current design direction, launch matrix, instructions and tooling;
   capture baseline browser evidence and reproduce the delayed-editor defects.
2. Unify selected-route counts, pages, dates and status; remove misleading route prose
   and repeated punctuation. Extend realistic browser regressions.
3. Improve personalised book composition, responsive controls and funnel usability;
   inspect desktop/mobile, light/dark, errors, loading and reduced motion.
4. Run applicable local release gates and a browser journey matrix; fix findings.
5. Leave local commits, visual evidence and a precise handoff with live-only acceptance
   and GitHub release steps still outstanding.

Done means the local candidate passes the applicable gates and visual/functional
journeys, with results and remaining human/live checks explicitly recorded. Five hours
is an availability window, not a reason to continue after useful work is complete.

## Preparation evidence

- Original repository clean on main at `0312f76`; isolated worktree created.
- Node v26.3.1; npm/npx, git, gh and caffeinate present. Local dependency install started.
- Playwright and axe are repository dependencies. Four hero scenes already have
  AVIF/WebP assets. No new video, model provider or asset-generation spend is needed.
- OpenRouter integrations found in editor and PDF review; no credentials read.
- `https://inksheaf.com` returned HTTP 200 to a read-only HEAD request.
- `caffeinate -i -t 18000` started for the user's absence. This session uses its current
  managed permissions; reading the night profile did not switch session profiles.
- The existing night profile was inspected. Its isolation and external-action rules
  are the operating contract here.

## Results and blockers

Local launch candidate complete. Real inbox delivery remains unproven. Do not call
production ready from the prior green deployment or from local mocks.

### Checkpoint 1 — correctness and submission

- Existing scroll suite passed on the unchanged base; before screenshots are in
  `output/playwright/baseline-scroll/`.
- New local-only edition journey reproduced 88 failed assertions on the base across
  desktop/mobile and light/dark. The fixture models the delayed 22-essay editor result,
  all three actual volume shapes, mismatched prose, and repeated reservation clicks.
- Selected route now supplies edition counts, words and pages. Description and live
  status update on every cadence and editor arrival. Prior interior/cadence selections
  survive editor arrival when still offered. Archive exclusions are explicitly labeled.
- Uneven books no longer inherit a false balance claim; sentence punctuation is joined
  once. Reservation submissions lock while pending and recover visibly on request or
  response failure. Failed previews clear the previous edition and captured plan.
- `test-edition-journey.mjs`: passed all four configurations, including axe and one
  reservation request on a double-click. All API calls are mocked, including signup.
- `npm run build`, `python3 validate.py` (13), source honesty (47), hero assets (31): pass.
- Full unit chain passed; see checkpoint 2 and the final evidence below.
- Chromium cannot bootstrap under the macOS sandbox. Automatic review approved the
  scoped local browser test execution outside it. No logged-in browser was attached.
- Playwright CLI was found, but its default daemon cache is outside writable roots;
  the repository's established Playwright scripts supply the working browser harness.

### Checkpoint 2 — composition and browser behavior

- Extracted `PreviewBook.astro`: publication-coloured cover, contrast-checked ink,
  readable portrait page, scalable mastheads, explicit open/close interaction, and an
  accessible archive sampler. Removed invented contents page numbers and the Inksheaf
  imprint from the publication's front cover.
- Desktop shows book and plan together; the price and reservation action precede the
  optional binding details. Mobile has a separately sized book and two-column choices.
- Preserved the four-frame hero, improved title controls, removed the fake input caret,
  added focus routing, and supplied a working no-JavaScript contact in the title page.
- Bundled the existing EB Garamond variable font with its OFL license. The normal Latin
  subset is about 44 kB; all seven language subsets total 260 kB and load by Unicode range.
- Keyboard cadence controls retain focus and support arrows/Home/End. Reservations
  recover after network errors, prevent repeated sends, and can be reopened. Verification
  fallback handlers reset between reservations and distinguish queued/dispatched proofs.
- Failed publication reads cannot be revived by the preceding editor response. Old
  response shapes use the selected division's totals; infeasible plans request a hand plan.
- Full preview unit chain: exit 0. Renderer suite: 69 pass, 0 fail. Generated renderer
  reports were restored; no renderer source changes are included.
- Chromium and WebKit edition journeys: four configurations each passed, including axe,
  simulated retry/deduplication and reopening after reservation.
- Design matrix: 30 screenshots, six states, zero WCAG violations at 1440 and 390.
  Evidence: `output/playwright/design/shots/astra-local/`.
- Additional edge journeys: 11 passed on the first run. Visual inspection caught the
  short landscape input crossing the book's paper edge despite fitting the viewport;
  landscape layout was corrected and is included in the final rerun.
- The local launch UI gate now runs an ephemeral static server and simulated browser
  checks. Added it to the existing GitHub `checks` job, before the artifact digest.
  Dispatch, release policy, protected environment, migration and deployment are unchanged.

### Checkpoint 3 — frozen candidate and handoff

- An open reservation now refreshes its captured plan after editor arrival or a binding
  change. Submission snapshots that choice and prevents a late editor response from
  changing it during the request. Failed submissions retain the fields and allow retry.
- Removed the fixed post-response replay delay. The loading message covers the actual
  read; the preview appears on response. A new read hides the previous book's controls.
- No-JavaScript visitors have a visible contact route without false interactive controls.
  Generic duplicate acknowledgements no longer claim a fresh email was sent.
- Final build, `python3 validate.py` (13), source honesty (47), hero asset checks (31),
  and `git diff --check`: pass. Full unit chain and renderer suite (69) passed earlier
  in this run; subsequent changes were confined to frontend behavior and local tooling.
- `npm run test:launch:ui`: exit 0 on the frozen source. Four edition configurations,
  16 edge-state journeys, and the full scroll/CTA/loading/error/reduced-motion gate pass.
- Explicit WebKit run: `node scripts/test-edition-journey.mjs http://127.0.0.1:8806/
  output/playwright/final-webkit webkit`: exit 0, four configurations clean.
- Design matrix: six states, 30 screenshots, zero WCAG violations. Automated checks
  do not replace an actual VoiceOver or physical iPhone review.
- Inspected desktop cover and mobile open-page screenshots and recorded the revised
  motion at 1280×720 and 390×844. MP4s are available alongside the original WebMs.
- Local review server smoke (without browser API interception): sample banner, delayed
  editor, 22-essay result, and simulated signup all passed; zero browser errors or
  external requests. The first smoke attempt had an ambiguous test selector; using
  the reservation field's ID fixed the harness without changing product code.
- Original checkout remains clean on main at `0312f76`. No push or release was made.
  GitHub/Linux execution of the newly added browser step remains to be proven in CI.

## Review and evidence

From this worktree: `npm run build && npm run review:launch`, then open
<http://127.0.0.1:8807/> and enter `caithrin.com`. The server was left running for review.
It binds only to loopback. Every API effect is simulated; feedback is explicitly not
saved. No credentials, email, reservation record or print job is created.

All paths below are relative to this worktree and intentionally ignored by Git:

- Before: `output/playwright/baseline-scroll/`, `output/playwright/baseline-edition/`.
- Final acceptance: `output/playwright/launch/`, `output/playwright/final-webkit/`.
- Design: `output/playwright/final-design/shots/astra-local/`.
- Motion: `output/playwright/final-motion/journey-1280.mp4` and `journey-390.mp4`.
- Durable local test logs: `output/playwright/final-logs/`.

See `LAUNCH_REVIEW.md` for review steps and the remaining external acceptance gates.
The vault handoff is `05-Projects/Substack Magazine/astra-launch-run-2026-09-06.md`.

## Approved motion pass — 2026-09-06 evening

Caithrin approved `frontend-motion-plan-2026-09-06.md` with “ok great. do it”. The
accepted default is a short scroll that triggers a complete opening. This supersedes
the retained four-render hero described in the earlier checkpoints.

- Replaced four photographic dissolves with one 24-position book opening against a
  fixed desk plate. Desktop and portrait each use one camera and deterministic book
  geometry. The portrait composition keeps the book and desk engraving visible.
- Hero height is 190svh desktop / 170svh portrait. Native scroll starts an 800 ms opening
  that completes after the wheel stops and does not replay on small reversals. The
  header settles immediately and focuses the field. No extra decorative page turn.
- Slow/missing motion, reduced motion and data saving have a still, usable fallback;
  no-JavaScript contact remains. Asset hashes version the URLs. Loading/error space is
  reserved; compact typing preserves focus and has a fully visible, clickable action.
- Final visual review caught a transient empty background when the transparent async
  poster became visible. The title poster is now decoded and kept beneath the closed
  cover/motion throughout; the motion gate checks painted paper pixels at the handoff.
- Personal-book hover no longer changes state. Click/tap/Enter/Space share one persistent
  open/close action with solid cover faces. Preview reveal is shorter; price is immediate.
- Built-in image generation supplied two edited desk plates; exact prompts and saved
  local master paths are in `scripts/motion/asset-prompts.md`. Blender 4.5.1 rendered the
  fixed scene offline. Delivered assets total 604 kB desktop / 850 kB portrait for the
  preferred poster pair plus once-playing WebP, with 30 kB / 48 kB initial AVIF posters.
  The manifest and asset gate verify actual hashes, 24 frames, 799 ms and one play.
- Blender was used from a read-only temporary disk image; task-owned processes were
  closed and the image detached afterward. No system install, preferences, OpenRouter
  calls, production credentials, real signup or deployment occurred.
- Build, validator (13), source honesty (47), hero assets (36) and diff whitespace pass.
  Chromium and WebKit each pass seven motion journeys, including compact typing bounds,
  hit targets and axe. WebKit edition acceptance passes all four configurations.
  The full local UI suite includes seven motion, four edition and 16 edge journeys plus
  scroll acceptance. Six design states / 30 screenshots report zero WCAG violations.
  The earlier full unit chain and print-renderer (69) remain the relevant backend/print
  evidence; this pass does not modify those systems.

Latest evidence, relative to this worktree and intentionally ignored by Git:

- Motion recordings: `output/playwright/motion-review/journey-1280.mp4` and `journey-390.mp4`.
- Motion acceptance: `output/playwright/launch/motion/`, `motion-accepted-webkit/`.
- Design: `output/playwright/motion-design/shots/motion-local/`.
- Logs: `output/playwright/motion-logs/`.

Continuous journeys were recorded and intermediate/settled states visually inspected.
Human normal-speed motion review, a physical iPhone/software keyboard and VoiceOver
remain acceptance work; automated WebKit and axe do not establish those results.
The local review at port 8807 remains explicitly simulated. Production remains unchanged
and any eventual release must use GitHub's protected production approval path.
