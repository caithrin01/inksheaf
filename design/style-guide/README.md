# Inksheaf — independent editions

Standalone style guide requested by the owner before rebuilding the site. This directory is
outside Astro's public/source trees and is not part of the release build.

From the repository root:

```sh
python3 -m http.server 8830 --bind 127.0.0.1 --directory design/style-guide
```

Open <http://127.0.0.1:8830/>. The guide contains the proposed identity, colour/type system,
four cover compositions, physical geometry, the subscriber button, component states and FAQs.
Controls demonstrate URL validation, clipboard copy, native disclosures, missing-logo states,
real-name/long-title cases and grayscale. They never request an archive or send a reservation.
The orange sample button opens the existing caithrin Lulu listing; it does not place an order.

The cover implementation here is a **prototype**, separate from the versioned production
renderer. `book-design.js` began from that renderer's markup and escaping helpers. Geometry
is deterministic CSS, with a down/right page edge and contact shadow; it is not a photograph.
The included essay spread comes from the existing real caithrin print file. The publication
mark uses the owner's existing transparent vector masters: charcoal on light covers, gold
on dark covers. `assets/publication-logo-sources.json` records exact sources and hashes.
The opaque Substack image is retained for the fallback and the rejected before comparison.

The outlined identity is built by `scripts/identity/build-publisher-identity.py` into this
guide's assets only. It derives from OFL Inter, with redrawn i/k and optical pair spacing.
Inter and Source Serif 4 licenses are included in `assets/`. The older serif logo is explicitly
labelled historical, not another new identity. SVG masters use currentColor as black when
loaded as images; the reverse specimens invert those masters in CSS.

Checks:

```sh
node scripts/identity/check-style-guide.mjs
node scripts/identity/check-logo-backgrounds.mjs
node scripts/identity/capture-style-stress.mjs
```

Screenshots/results: `output/style-guide/`. Actual external review command:

```sh
npm run review:frontend -- scripts/identity/style-guide-review.json <new-evidence-directory>
```

The initial style-guide call truncated; it is not counted as completed. Direction consultation
and the subsequent complete guide critique are recorded separately. Critique is not owner
acceptance. Site integration, renderer gates, real email delivery testing and approval-gated
release remain separate work. No direct Cloudflare deployment.


## Paper refinement

After positive owner feedback, `paper.css` adds localized stock warmth (`#F7F4ED`),
static grain (SVG alpha capped at 4.5%), a fine sheet edge and a single folio. It does
not texture the global page, wordmark, controls or newsletter button. Type paints above
the grain. The paper texture is removed for increased-contrast preference and guide
printing. `capture-paper.mjs` records desktop/mobile material specimens. Before images
are retained under `output/style-guide-paper/before/`.

## Publication logo backgrounds

The original image's charcoal square blended into Masthead and looked pasted onto the other
three covers. Adding a padded plate failed the owner's visual review. The default now uses
verified owner-supplied transparent assets; it never assigns caithrin's mark to other fixtures.

- Prefer original transparent artwork and approved light/dark variants. No CSS filters,
  background removal, redrawing or automatic recolouring of publication marks.
- With only a flat opaque source, extend its actual ground into a full-width publication
  band, composed with the footer metadata. Adapt the surrounding composition: Field notes
  merges its lower block with the charcoal band; Masthead retains its inset footer rule.
- Complex/photo backgrounds remain intact and need composition in the proof. Any knockout
  or new one-colour adaptation requires the writer's proof review.
- With no usable logo, the publication title carries the cover without an empty placeholder.

The guide's select offers transparent masters, integrated opaque fallback and the rejected
square for comparison. The geometry specimen follows that selection. This is a prototype
policy, not a claim that production ingestion can discover or prepare transparent masters.

Checks and captures: `output/style-guide-logo-background/`. Completed external Opus review:
`output/frontend-review/logo-backgrounds/` (pre-final fallback refinement). The final default
is unchanged from that reviewed image. Fine logo strokes still require a physical proof.
