# Inksheaf identity — approved September 7, 2026

The approved wordmark is substantial lowercase Inter-derived lettering with a square i dot,
a redrawn open k and optical pair spacing. The SVG paths match the accepted style guide
byte-for-byte. The preceding serif and wheat treatments are historical explorations.

Use `src/components/Logo.astro` for site identity. It selects the small or large master and
supports an explicit reverse treatment for dark brand surfaces. Preserve the natural aspect
ratio. Preferred minimum is 160px, with 120px demonstrated for constrained spaces. Clear
space is twice the i-dot width. The favicon derives from the same i; use the full name wherever
it fits. The original OFL Inter and Source Serif 4 licenses are in `public/fonts/`.

Authoring source: `scripts/identity/build-publisher-identity.py` and
`design/style-guide/assets/`. The authoring script writes guide assets only; after visual
review, the approved masters are copied to this directory and the favicon to `public/favicon.svg`.
Do not use the historical `build-identity.py` output for the approved site.

The publication owns its book front and spine. The caithrin d20 assets in `public/book/` are
verified publication artwork, separate from Inksheaf's identity. Their source hashes are in
`public/book/publication-logo-sources.json`. The version 2 cover source is shared by the web,
reservation snapshot, proof and print wrap. Version 1 remains reproducible from its own files.
