# Inksheaf design critique

## 1. What the images actually show

**Image 1 (desktop oblique).** The materials read well: walnut grain, brass lamp base, warm falloff, and the burned sheaf are all credible and restrained. The failure is geometric. The headline, sub, label, field and button sit dead-flat on a page that is clearly receding in perspective — the type is in screen plane, the paper is not, so the whole thing reads as a PNG with a caption pasted on. The book itself is wrong: the left page is a large trapezoid, the right page shows an odd grey-to-cream gradient, the spine has no visible gutter shadow, and the block has no believable thickness or contact shadow where it meets the wood. Proportions are nowhere near 6×9 per page. The verso being entirely empty while all content crowds the recto wastes half the composition.

**Image 2 (mobile oblique).** Worse: the spread is cropped so the "book" reads as a beige panel with a hairline, and the left page becomes a meaningless white sliver. The engraved sheaf is pushed below the fold into dead space. Input and button are legible and reasonably sized, which is the one strength.

**Image 3 (angled draft).** Type is now smaller and pushed into the recto's inner margin, and the field/label outlines break the plane even more visibly — three red/black rectangles floating over a receding page. Headline size has collapsed relative to Image 1, so hierarchy weakens. Lighting is nice; the concept is unsalvageable. The owner's rejection is correct on the evidence.

**Image 4 (preview, desktop).** The strongest screen here. Left/right split is clear, the pricing and honesty copy ("Nothing prints until you approve your proof") build credibility, and the plan row with strikethrough MONTHLY is legible. Faults: the cover thumbnail is blank cream with a stray magenta/violet top edge line and a hard sliver of "page edges" that reads as an artifact, not a book; there is no title, no publication logo, no author on the cover, which is exactly the "generic default" complaint. Large empty area under the thumbnail. The spine strip mini-books at the bottom are cut off by the fold. "Look inside ↗" uses an external-link arrow for what should be an in-page action.

**Image 5 (mobile look inside).** Reported identity bug is visible: the page header reads "CAITHRIN," not "The Fox Says." I can see the wrong string; I can't verify the metadata fix from a screenshot. Also, this is a titles list under "From the archive" — a table of contents, not a laid-out page — which is the accepted gap. Positive: the framed page has good margins, sensible measure, and the disclaimer "Final contents are set in your proof" is honest.

Motion quality, doubled cursors, focus rings and reduced-motion cannot be judged from any of these.

## 2. Verdict on the overhead study (Image 6)

Right direction, wrong measurements. The flat-on view removes the plane conflict entirely and lets live HTML text sit legitimately on paper — that alone justifies the change.

Corrections required before implementation:

- **Aspect ratio is wrong.** Each page here is roughly square-ish/portrait at about 1:1.35, and the full spread is far wider than tall. A true 6×9 page is 1:1.5; an open spread is 12×9, i.e. 1.33:1. Do not trust the prompt — remeasure and regenerate, or crop/rebuild so a single page is verifiably 2:3.
- **Gutter.** The center shows two nearly-touching flat sheets with a faint seam and no inner-margin darkening. A perfect-bound 180-page block does not open flat; add a shallow gutter shadow and slight page curvature toward the spine, and keep live text out of the inner ~0.6 in.
- **Contact shadow / thickness.** The block appears to float; the text block edges are visible at right but there's no consistent occlusion shadow under the boards, and the left board edge is thinner than the right. Add a tight, low-opacity contact shadow plus a believable ~0.5 in block.
- **Engraving orientation.** The burned sheaf is correctly viewed straight down and sits well in the left third — the best-resolved element. Keep it, but note it competes with the lamp base directly above it; the two crowd the left column.
- **Usable space.** Generous and even, which is the point. But the spread is off-center to the right and the lamp base is clipped at the top-left corner, which looks accidental. Recentre so the left page can host headline + input with symmetric margins.

## 3. Recommended composition and interaction

**Do not animate a book opening.** One static overhead plate, no scroll-driven camera.

**Desktop.** Full-bleed overhead desk plate as background. The spread is centered, ~72% of viewport width, capped at ~1100px. Verso (left page): eyebrow "Your Substack, bound as a book.", one-line sub, then label + URL field + primary button, all left-aligned to the page's text block, live HTML in screen plane — which is now the paper plane. Recto (right page): three short specifics (6×9 perfect-bound · print at cost · approve your proof before printing). Nav and "Try it for my Stack" stay as-is. No forced scroll; the input is visible on load and focus-first.

On submit, the same spread cross-fades (150–200 ms, respecting `prefers-reduced-motion`) to the preview: verso becomes the cover, recto becomes the volume/pricing panel. "Read a sample page" is a plain in-page button beneath the cover; it swaps the recto to a real typeset page — actual first paragraphs of a real post, correct running head ("The Fox Says"), real folio if computable, otherwise no folio at all and a visible "sample layout, not final pagination" note. Prev/next page arrows, keyboard-operable.

**Mobile.** Drop the spread. Use a cropped desk strip (~120px) with lamp and sheaf as a header band, then a single stacked card styled as one page: headline, sub, label, field, button — normal document scroll, input above the fold. Preview state stacks cover → facts → "Read a sample page", which pushes a full-width single page view with the same running head and back link.

## 4. Four book design directions

1. **Broadsheet.** Scotch-Roman-flavoured serif text with a condensed didone display face; palette warm white with deep ink and a single vermilion rule. Publication logo small, black, centred above a large title; author below a hairline. Cover hierarchy: rule → title → logo. Interior: single column, generous outer margin, small-caps running heads, drop folios.
2. **Field Notebook.** Grotesque display, humanist serif text; palette oat board, olive spine band, no gloss. Logo blind-debossed at lower right rather than printed. Cover: title set flush-left low on the board, date range above. Interior: wide outer margin reserved for marginal date stamps, section dividers as thin olive rules.
3. **Dark Cloth.** High-contrast transitional serif, all-caps spaced display; palette near-black with warm brass foil-look accents. Logo reversed to brass, centred and small, above a stacked title. Cover: heavily centred, symmetrical, spine-forward. Interior: cream stock, larger leading, decorative chapter openers with brass-toned initial.
4. **Plain Editions.** One unmodulated sans for cover, one serif for text; palette cool grey-white, single-colour ink chosen from the publication's own accent. Logo used at full colour, largest element on the cover, with title beneath in modest type. Cover: logo-led, near-typographic-only. Interior: tight, tabular front matter, no ornament, essays separated by a single line space and a numeral.

All four are proposals; font availability and how faithfully the renderer reproduces them must be confirmed against the actual print pipeline. Presets should read from the same stylesheet the renderer uses, or be labelled as previews.

## 5. Prioritized acceptance checks

1. **Identity.** manifund.substack.com resolves to "The Fox Says" with that publication's own Substack logo leading cover and preview; "Caithrin"/"Carol" appear nowhere. Verify across two or three other publications, including one with no logo.
2. **Real sample page.** Look-inside shows genuine article prose in the chosen preset, correct running head, and either a truthful folio or none — plus a visible "not final pagination" caveat. No lorem, no invented excerpt.
3. **Geometry.** Measure the rendered page: single page 2:3 within 1%, gutter shadow present, contact shadow present, text kept out of the inner margin.
4. **Interaction and access.** Live browser: single cursor, normal scroll, input reachable without scrolling on desktop and mobile, visible focus ring on field/button/page arrows, full keyboard traversal, and reduced-motion honoured. Screenshots cannot prove any of this — record a short capture and a keyboard-only pass.
5. **Preset fidelity.** Each of the four directions differs in font, palette and layout, stays recognizable as the publication, and is traced to the print renderer or explicitly labelled preview-only. Print fidelity requires a physical or PDF proof, not a screenshot.
