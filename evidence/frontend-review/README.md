# September 7: external frontend model reviews

Actual model: `anthropic/claude-opus-5` through OpenRouter. Three completed critiques,
one incomplete first attempt. Total reported OpenRouter cost: **$0.441515**. Image-generation
cost is not included. Exact model responses, usage and input hashes are retained here.

| Run | Inputs | Result | Cost |
| --- | --- | --- | --- |
| `2026-09-07-opus-topdown` | Rejected hero, current book, generated overhead study | Truncated; failed | $0.166635 |
| `2026-09-07-opus-topdown-complete` | Same six images | Completed critique | $0.119185 |
| `2026-09-07-opus-study-revision` | Implemented overhead study and repaired WebKit cover | Completed critique | $0.077635 |
| `2026-09-07-opus-study-final` | Revised study after edges/lighting/logo changes | Completed critique | $0.078060 |

The runner and prompts are in `scripts/design-review/` and `scripts/review-frontend.mjs`.
Full labelled image copies remain under matching `output/frontend-review/` directories.
A completed critique is not a green design gate.

## Findings acted on

- The model found a **blank WebKit cover** earlier DOM tests missed. Actual screenshot
  inspection confirmed it. Removing 3D backface layers repaired it; a new Chromium/WebKit
  regression compares the painted masthead with that text hidden.
- The generated overhead book had wrong proportions and was rejected. The study uses a
  separate generated desk plate and deterministic 2:3 HTML/CSS book geometry.
- The study exposes its input immediately, uses explicit cover/real-excerpt controls,
  differentiates four proposals, and uses the owner's actual publication logo and prose.
- Later refinements added paper edges, directional shadow, bigger original marks, a quieter
  Masthead rule and photo-background contrast measurements. Minimum measured small-text
  contrast in the tested views is 6.5176:1; browser results are retained here.

## Advice checked, not blindly accepted

The first complete response falsely treated the caithrin fixture as the unrelated Fox Says
identity bug. Foil/debossing/cloth proposals were outside the product. Later briefs corrected
both. The model momentarily confused reciprocal page ratios; browser measurements establish
2:3. Print-wear predictions and universal title-fit claims are unproven by these inputs.

After the final review, **physical book realism remains unresolved**: the model still sees
a flat UI object. It also wants the control stack condensed and a better mobile engraving
crop. Its preferred treatment changed from Classic to Masthead after the logo/layout revision;
that is an opinion on different revisions, not user approval or print validation.

## Product status

Local source implements publication-name/metadata/logo and WebKit cover-painting repairs.
Unit, build and local browser checks passed. Public homepage reads confirm The Fox Says
and caithrin names/logo metadata. No production API journey was sent.

The overhead hero, preset persistence/print rendering, and arbitrary-publication excerpt
reader are **not built into the working product flow**. The study is a concrete review
artifact, not completion of those items. No push, deploy, live email, reservation or press run.

Next meaningful visual checkpoint must use the external reviewer again. Do not substitute
session inspection and call it a model review. Full status is in the vault's
`frontend-topdown-review-2026-09-07.md`.
