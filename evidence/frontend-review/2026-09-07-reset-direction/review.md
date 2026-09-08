## 1) Biggest risk: this is a "grey grid" redesign, not an identity

The thesis as written is a description of every 2019–2025 D2C landing page: light grey ground, black lowercase grotesk, big product shot, tidy grid. Nothing in it is *specific to a Substack writer's own publication becoming an object*. If you build it exactly as stated, the only thing separating you from a Shopify theme is photography quality — and you don't own a photo studio.

Look at what the references actually do. Fitzcarraldo isn't distinctive because of grey concrete; it's distinctive because **one colour system is enforced across every title** (blue for fiction, white for essays) so the shelf reads as a house before you read a word. Stripe Press isn't distinctive because of a dark page; it's because you see **spines edge-on, stacked**, the least commercial view of a book anyone chose. A24 works because the ground is aggressively neutral and **shadow-only**, so nine unrelated covers still read as one catalogue.

Your differentiator is structural, not decorative: *the covers are yours but the format is ours*. Make that visible. Concretely:

- **Fix one house constant across all four covers** and state it. Recommendation: a consistent bottom-band metadata line (publication name · edition · date · folio) at an identical measure and baseline on every cover, plus identical trim. That's your Fitzcarraldo blue equivalent — it survives whatever the writer's colour is.
- **Kill the word "grey studio ground."** Specify a value: one near-neutral (≈#EDEDEA, warm-shifted 2%) plus true black type. Warmth prevents the dead-blue tech-grey that made the beige rejection feel like an overcorrection.
- **The books must not be centred and floated.** That's the generic tell. Crop them off the right edge or bleed them below the fold so the composition can't be mistaken for a product card.

## 2) Logo refinements

"Heavily weighted lowercase grotesk" is a brief, not a mark. Decisions needed:

- **Draw, don't set.** Take a base (Inter Display Black / Archivo Black) and modify at minimum three joins: shorten the `f` overhang so it can tuck the `s`; flatten the `a` bowl; cut the `k` leg to a straight diagonal terminating flush with the baseline. Without letterform edits you have typed text.
- **Exploit the ligature you already own:** `inksheaf` has `k`+`s` and `f` adjacency. Tighten `nk` and `sh` to near-touching, keep `ea` open. The rhythm — tight/tight/open — is the signature.
- **Single-storey vs double-storey `a`:** pick double-storey. Single-storey geometric reads startup-2016.
- **Favicon:** an `i` alone is weak at 16px — a dotted stem is a generic bar. Instead crop the **`nk` pair** or use the `i` dot as a solid square (not round) at 1/3 the stem width, with the stem cropped by the frame edge so it reads as a mark, not a letter.
- **Masters:** black on transparent, white on transparent, plus a **minimum-width spec (140px web / 22mm print)** and a locked wordmark-to-nav-baseline relationship. No lockup with tagline; the promise line does that work.
- **Never on covers** — correct as briefed. Put it on the *back* cover base only if you must, small, one line.

## 3) Strongest opening composition

**Desktop (≥1280):** Full-bleed single frame, no hero card.

- Row 1, 64px from top: wordmark left at ~180px wide; three text links right. Nothing else. No CTA in the nav.
- Left column occupies columns 1–5 of a 12-col grid, starting ~180px below nav: promise at 72–88px, tight leading (0.92), max two lines: "Your Substack. In print." Immediately beneath (32px), the URL input — full column width, 64px tall, black 1.5px rule, black submit label, placeholder showing a real URL shape. One line of 15px grey under it: "6×9 matte paperback · US private beta."
- Right/bleed: columns 6–12, **overhead composition bleeding off the right and bottom edges**, 4–5 books at true 6×9 proportion, one shown edge-on so page edges and spine thickness read. Cast shadow only, single light direction. No perspective distortion, no mockup gloss.
- Books should overlap the left column's bottom edge slightly — that interlock is what stops it looking like two panes.

**Mobile (≤430):** Wordmark and promise at 40–46px, input directly beneath at 56px tall and full width minus 20px margins — visible without scrolling. Books enter **below** the input, cropped left-and-right full-bleed, 3 books max, page edges still legible at that scale. Do not shrink the desktop arrangement.

## 4) Making four covers desirable, not template cards

- **Don't present them as a 4-up equal grid.** Show one at large scale with the other three as smaller stacked alternates, then let selection swap the large one. Equal grids read as "pick a theme."
- **Give each a different type-to-field ratio, not just a palette.** Masthead: title occupies ~55% of cover height. Classic: ~18%, huge margins, frame inset asymmetric (wider foot). Field notes: title breaks across two colour blocks so it's read in two moves. Midnight: single italic line at 40% height with the rule *above* it, not below.
- **Vary optical size, not just point size.** Inter for Masthead/Field notes must use tight tracking (−2%) at display sizes; Source Serif 4 for Classic/Midnight needs its display optical size, or it will look like body copy blown up.
- **Show them as objects, not flat art.** Each preview needs spine thickness and page edge, at 6×9. Flat rectangles are the template tell.
- **Long-title stress test is part of the design**, not QA: define per-composition line-break and shrink rules and show a 60-character title in the gallery.
- **Publication colour is applied to one surface only** per composition, so a bad brand colour can't wreck it.

## 5) Acceptance tests (observable, static)

1. **Grey test:** sample the background at five points — all within 2% of the specified neutral, and its hue is warm-shifted, not blue. Books remain the only saturated elements above the fold.
2. **Proportion test:** measure every book image; width:height = 6:9 (±1%), spine thickness consistent across all four covers, one light direction throughout.
3. **Wordmark test:** overlay the delivered mark on unmodified Inter Display Black at matched cap height — at least three glyph outlines differ measurably. Favicon at 16px is still distinguishable from a plain letter.
4. **Cover differentiation test:** convert all four previews to greyscale. Each remains identifiable by type scale and layout alone; title-height percentages differ by ≥15 points between the largest and smallest.
5. **Fold test:** on a 1280×800 viewport and a 390×844 viewport, the URL input is fully visible and its full width is uninterrupted; the orange subscriber-button section begins immediately after, with no marketing block between.

Note: motion absence, keyboard access, real-device rendering and Lulu print fidelity are not provable from comps — test those separately.
