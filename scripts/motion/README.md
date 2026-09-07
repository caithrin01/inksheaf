# One book opening

The browser uses two static posters and a once-playing animated WebP per composition.
A small downward scroll starts the 800 ms movement; it completes without capturing
scroll. The header action immediately settles the image and focuses the real field.
Reduced motion, data saving, a missing motion asset or slow decoding goes to the still
usable title page. The native image decoder handles the frames; no video player,
real-time 3D runtime or array of decoded full-screen frames is shipped.

## Rebuild the assets

The delivered `public/motion/` assets are sufficient to build and serve the site.
Rebuilding the offline artwork additionally needs the two local background masters
listed in `asset-prompts.md`, the EB Garamond TTF in `assets/motion/`, Blender and ffmpeg.
The TTF is the Google Fonts EB Garamond variable source covered by `public/fonts/OFL.txt`.
The renderer can use Blender's built-in font if the TTF is missing, but that is not the
reviewed typography; restore the font before a final asset rebuild.

This run used [Blender 4.5.1 LTS from the official mirror](https://mirror.blender.org/release/Blender4.5/),
mounted read-only under `/private/tmp/inksheaf-blender-mount`. It was not installed in
`/Applications` and no user preferences were changed. A `--gpu` run selects the local
Metal device in that process; omit it for CPU rendering.

```sh
blender --background --factory-startup --python scripts/motion/render-book.py -- --gpu
blender --background --factory-startup --python scripts/motion/render-book.py -- --gpu --mobile
node scripts/motion/encode-assets.mjs
npm run test:hero
npm run build
npm run test:launch:ui
```

`--draft` renders three diagnostic positions at a smaller landscape size. `--resume`
skips existing frame files and is only valid when their scene settings are unchanged.
Full sequences contain 24 eased cover positions at 30 fps; endpoints render first to
allow layout inspection. Page corner coordinates are exported with the frames. The
HTML overlay and images share one fixed aspect-ratio scene, preserving their registration
as the viewport crops it. Portrait uses its own camera and photographed desk plate.

`encode-assets.mjs` writes the exact file sizes, hashes, dimensions and page coordinates
to `public/motion/manifest.json`. The asset gate inspects the WebP frame count, duration
and loop count from the file itself. Browser acceptance covers trigger/stop/reverse,
keyboard skip, stable loading/error positions, motion failure, reduced motion and the
personal book's deliberate open/close behavior. Visual recordings remain part of review.
