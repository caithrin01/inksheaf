# Shared book assets

`cover.css` is the exact face layout used by the browser preview, watermarked proof cover and final wrap. Version 1 offers Masthead, Classic, Field notes and Midnight. The cover selection and normalized palette travel in `plan_json.design` through reservation, verification, proof/version and approved listing.

`desk.webp` is a compressed copy of the generated overhead desk master at `assets/motion/topdown-study-2026-09-07/desk-only.png`. Its prompt is recorded in `scripts/design-review/topdown-desk-prompt.txt`.

`overhead-object.webp` is a deterministic orthographic 6×9 matte paperback and contact shadow, rendered with `scripts/motion/render-overhead.py`. It contains no publication type. The HTML face supplies the actual printed design. Rebuild with Blender, then:

```
cwebp -q 86 assets/motion/topdown-production/overhead-object.png -o public/book/overhead-object.webp
```

`paged-0.4.3.js` is the pinned Paged.js 0.4.3 distribution from `https://unpkg.com/pagedjs@0.4.3/dist/paged.polyfill.js`; license is adjacent. It is loaded only when the reader opens. The sample uses `functions/lib/book-interior.js`, also imported by `scripts/build-book.mjs`. Page layout is completed at native print size before the page is scaled; automatic repagination listeners are disconnected afterward. This prevents hiding/resizing a preview from corrupting its layout.

New print designs use locally served, OFL-licensed Source Serif 4 and Inter subsets under `public/fonts/`; print PDFs embed those files and EB Garamond directly. Font CSS came from Google Fonts on September 7, 2026. Original licenses are alongside the fonts.
