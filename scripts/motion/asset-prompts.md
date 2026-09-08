# Inksheaf fixed desk plates

Generated using the built-in image-generation tool, then used as fixed background plates
by `render-book.py`. The book, cover type, opening positions and shadows are rendered
locally from one deterministic scene. No OpenRouter call or image/video API key was used.

The project-local masters stay under the repository's existing ignored `assets/` policy:

- `assets/motion/desk-plate-source.png`
- `assets/motion/desk-portrait-source.png`

The delivered stills, one-shot image sequences and measured manifest are in `public/motion/`.
The generated photographs were inspected before rendering; the camera and plate remain
fixed through each complete opening. The portrait plate is a recomposition, not a pixel-
identical crop of the landscape photograph.

## Landscape plate — edit of `public/storyboard/s1-desk.jpg`

Use case: precise-object-edit. Asset type: clean photographic background plate for the Inksheaf book opening on its existing landing page. Edit target: the supplied existing photograph. Remove ONLY the cream cloth book and its cast shadow from the desk, reconstructing the walnut grain naturally in the entire formerly occluded area. Keep the exact original camera angle, framing, aspect ratio, warm light, brass lamp, lamp base, desk edge, focus, exposure and grain. Critically preserve the existing dark wheat-sheaf engraving burned into the wood at lower left, in exactly the same location, scale and shape. The result must be the SAME photograph of the now empty desk, with lamp and engraved sheaf still present. No book, no pages, no paper, no other objects added, no text, no UI. Full-bleed landscape image matching the reference. Do not modernize, brighten, relight or recompose the scene.

## Portrait plate — edit of the landscape plate

Use case: precise-object-edit. Asset: mobile portrait background plate for the same Inksheaf desk scene. Edit this empty walnut desk photograph into a tall 1:2 portrait composition. Preserve the same warm lamplight, beautiful walnut grain, and exact wheat-sheaf engraved/burned mark design. Reframe from almost overhead, with the desk surface filling the entire photograph, no wall. Keep only a small portion of the brass lamp base entering at the UPPER LEFT CORNER. Position the engraved sheaf SMALL on the wood at x=20% of width, y=83% of height, width about 12% of the image. The middle and upper-middle of the desk must be clean uninterrupted walnut, clear for the separately animated book. The book will cover x=15..95%, y=15..71%, so the engraving MUST be BELOW that area. Keep the engraving crisp, physically burned into the grain, and identical in design to the supplied reference; not a floating logo or white line art. Photoreal, tactile fine wood, pool of amber reading light on the left, deeper walnut shadows on the right and bottom. No book, paper, text, hands, extra props, graphics or UI. Output tall portrait 1:2.
