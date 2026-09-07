# inksheaf repo

Beta site for inksheaf.com (Astro static, Cloudflare Pages, D1 signups).
The product's plan, design brief, launch plan and validator doc live in the vault at
`05-Projects/Substack Magazine/`. Follow the design brief and its voice rules for all copy.
Run `python3 validate.py` before shipping.

## Frontend model review

The owner explicitly requested external model help during frontend design and repeated it
after an incident about substituting session inspection. At meaningful visual checkpoints,
use the runnable OpenRouter review in `scripts/design-review/README.md`, save the actual
response and distinguish its findings from browser tests and your own inspection. Do not
call a truncated/failed request reviewed, or a completed critique design approval.
Current overhead exploration and unfinished product integration are recorded in the vault's
`frontend-topdown-review-2026-09-07.md`. Preserve the writer-own-publication-only scope.

## Renderer test gate
`node scripts/test-renderer.mjs` must exit 0 before committing renderer changes. It builds the
torture fixture, renders it, and asserts filters, structure, and a text-integrity scan (glyphs past
the page edge = silently lost print content, the class of bug that hyphens:auto caused).
