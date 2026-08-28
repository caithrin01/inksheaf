# inksheaf repo

Beta site for inksheaf.com (Astro static, Cloudflare Pages, D1 signups).
The product's plan, design brief, launch plan and validator doc live in the vault at
`05-Projects/Substack Magazine/`. Follow the design brief and its voice rules for all copy.
Run `python3 validate.py` before shipping.

## Renderer test gate
`node scripts/test-renderer.mjs` must exit 0 before committing renderer changes. It builds the
torture fixture, renders it, and asserts filters, structure, and a text-integrity scan (glyphs past
the page edge = silently lost print content, the class of bug that hyphens:auto caused).
