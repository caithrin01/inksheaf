# Inksheaf frontend model review

This is an actual external vision-model call, separate from Codex looking at screenshots.
It was built after the owner repeated the request and pointed to the September 4 incident
about substituting session inspection for a repeatable model review.

## Run a review

From the repo root:

```sh
npm run review:frontend -- scripts/design-review/topdown.json
```

The manifest names the model, brief, token ceiling, and labelled image files. The runner
verifies current image support in OpenRouter's catalogue and makes one paid call. It reads
`OPENROUTER_API_KEY`, or the existing `~/.secrets/openrouter` token, without executing the
credential file. It never prints the token and never substitutes a different model.

Each output directory records the prompt, labelled copies and SHA-256 hashes of every
image, raw response, model ID, usage/cost, critique, completion status, and a replay manifest.
An empty/truncated response, missing credential, timeout or API error exits nonzero. Existing
evidence directories cannot be overwritten. A completed call means a critique was returned;
it does **not** mean the design passed or the site is ready to launch.

```sh
npm run review:frontend -- output/frontend-review/<run>/replay.json
```

Screenshot masters remain local under `output/`; compact original reports are kept in
`evidence/frontend-review/`. A fresh checkout needs its own screenshots. The runner is useful
for any frontend checkpoint: supply new images and honest state labels in a manifest. It is
explicitly invoked, not a billable side effect of every build, and does not change PDF review.

## Review the overhead study

```sh
npm run build
INKSHEAF_REVIEW_PORT=8808 npm run review:launch
```

Open `http://127.0.0.1:8808/design-study/`. In another terminal:

```sh
node scripts/design-review/capture-study.mjs
npm run review:frontend -- scripts/design-review/study-review.json
```

The study is served only by the local review server; it is excluded from Astro's release
artifact. Four cover treatments and three actual public excerpts from the owner's own
publication are interactive. The study is fixed to caithrin.com and cannot send a reservation.
It is **not** the production preview, a final print proof, or a renderer-supported preset picker.

`capture-study.mjs` checks Chromium/WebKit at 1280 and 390 widths: 2:3 book geometry, immediate
input access, keyboard controls, all excerpt/preset combinations, overflow, axe, and actual
photo-background pixels behind the small text. These checks are distinct from model critique.

## Image assets and source material

- Built-in image generation supplied the open-book study and then an empty overhead desk edit.
- Saved locally: `assets/motion/topdown-study-2026-09-07/open-desk.png` and `desk-only.png`.
- Exact prompts: `topdown-image-prompt.txt` and `topdown-desk-prompt.txt` in this directory.
- Source reference: `public/storyboard/s1-desk.jpg`. The first generated book failed the 6×9
  proportion check and is **not** used as the study's book. The later background contains only
  desk/lamp/engraving. The current study draws the book geometry and type in HTML/CSS.
- Actual publication name/logo came from caithrin.com's Substack homepage metadata. The prose
  in `study-content.json` comes from the owner's [September 1 essay](https://caithrin.com/p/the-data-center-backlash-wont-last).
  It is an excerpt, not invented sample copy or a final typeset proof.

## Continue the product work

The owner accepted: their own publications only; correct publication name; their own Substack
logo; different designs; real readable previews; exploration of a top-down desk. Next work
must retain those constraints and use this model-review command on the next meaningful
visual checkpoint. Do not describe local sampling as launch coverage.

Still not built into the working production flow: the overhead hero replacement, four presets
persisted into reservations and rendered identically in proofs, and a real public excerpt
reader for arbitrary owner publications. The production-candidate naming/logo fix and WebKit
cover painting repair are implemented separately in the main source and tested locally.

Keep the protected GitHub approval-gated release path. No direct Cloudflare deployment.
