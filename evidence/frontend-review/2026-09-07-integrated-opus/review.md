## Verdict

The overhead direction reads as a real desk with a real book on it, not a 3D trick, and the shared cover/print CSS is visible in the fact that the four styles differ in typographic logic rather than in filters. Masthead is genuinely good. The remaining problems are interface-state and layout problems, not concept problems. Nothing here proves the motion, keyboard, print or identity claims — those still need their own tests.

## Three highest-impact visible flaws

**1. Contradictory cover-selection state.** In image 6 the displayed cover is Midnight and "Midnight" is underlined, but the *Classic* thumbnail still carries the red selection outline. Image 4 shows both marks on Classic, so the outline and the underline are two competing selected-styles and one is stale. Fix: one selected token only — filled/outlined chip plus label weight change applied by the same state, and remove the red ring from the non-active chip. This is the single most damaging bug for a beta, because the picker is the page's core interaction.

**2. Mobile: the fixed review bar eats the text, and the picker arrives context-free.** In images 3 and 5 the two-line footer overlays the bottom of the excerpt and of the "Your writing, in one book." block; in image 3 the thumbnail row is the first thing under a truncated step strip, with no publication name above it. Fix: give the page bottom padding equal to the bar height (or make the bar non-fixed on mobile), and put "caithrin · Annual 2025–26" as a small heading directly above the cover chips so the mobile column reads name → cover → sample → price.

**3. Design and sample controls are under-weighted relative to their importance.** "Read a sample ↗" is a 13-ish px tab beside "Cover", and in image 5 "Enlarge" is a small text link with no visible "Actual size" partner, while the arrows are unlabelled glyphs. Fix: promote Cover/Read a sample to a proper segmented control at cover width, and render the reader controls as a labelled row — `← 1/4 → | Enlarge | Actual size` — with hit targets at ≥44 px on mobile.

## Secondary, cheap to fix

- Classic's cover is the weakest: double hairline frame plus a small floating d20 in the upper third reads like a template; tighten the logo/title spacing and lose one rule.
- The volume-thickness widget crops mid-label at the fold in image 4 (`163pp / $6.07` clipped); reserve its height.
- Desktop hero has a large empty right-of-book area and a mushy lamp-base blob top-left; crop tighter or shift the book up.
- Excerpt: the 6×9 measure at mobile width is small and grey-on-cream is low contrast at that size; a slightly larger default with Enlarge as the escape hatch would be safer than relying on the control.

## Carry-forward

Yes. The overhead desk, the "Your publication" generic hero, the real name/logo on the fixture and the Paged.js excerpt are credible enough to take into a limited private beta once the selection-state bug and the mobile footer occlusion are fixed. What still has to be verified outside these images: keyboard and focus order through the chips and reader, Actual size fidelity against a physical proof, and the real-fetch path for names, logos and excluded posts.
