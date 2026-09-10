## What's actually in evidence

Three local fixtures: a genuinely Typst‑compiled three‑leaf PDF painted by PDF.js, with a synthetic title ("The things we keep"), a synthetic byline ("A synthetic edition · Browser reading fixture") and intercepted API events. The forty‑two‑page API figure is fixture data, not the owner's 152‑page annual book, which is held separately. No author contact, upload, public URL or purchase happened. Static frames can't demonstrate Previous/Next disabling on unavailable pages, retirement of pages on a saved‑selection change, non‑auto‑advancing snapshot replacement, keyboard focus order, screen‑reader behaviour, PDF.js at other viewport widths, or classification of poetry/recipe line breaks — those remain behavioural questions. This is critique, not browser or print acceptance.

## Hierarchy and paper restraint

The direction holds. One wordmark, one hairline rule, one type family for the interface, the book's own serif inside the leaf. No desk perspective, no gauges, no page‑count trophies. The page sits on a soft grey mat with a plain white leaf and a modest drop shadow at the cover only — that's the right amount of print cue: enough to say "this is a leaf of paper," not a mockup.

Hierarchy reads correctly: title → status line → tabs → section heading → view toggle → leaf → navigation. "Pages" as a third tab, present because an artifact exists, is quiet and doesn't shout for attention. The cover's "Read the first pages →" gives a second, gentler entry.

Reading comfort inside the leaf is good on desktop: measure looks like 62–68 characters, generous leading, justified with acceptable rivers. The reflowed text view on phone is the standout — real reading rhythm, sensible paragraph spacing, and it earns its place rather than feeling like a fallback.

Is it rewarding to watch? Mostly yes, because the reward is the writing itself rather than progress theatre. The weakness is that the *evidence of decisions* is thin: you see a finished‑looking leaf and a sentence saying layout checks continue, but nothing that says what changed or that a newer leaf has arrived.

## Highest‑value refinements

**1. The page label collides with the preview index.** "Page 1 · 2 of 3 preview pages" reads as a contradiction — two numbers, both called pages, one from the renderer and one from the excerpt set. Separate the roles and let the renderer label speak as a book label:

> Left of centre: `Page 1` (renderer label, unchanged)
> Centre: `Second of three excerpts`

Keep the renderer label verbatim so roman/front‑matter labels survive; make the count ordinal prose so it can never be mistaken for pagination. This is the single clearest confusion in the frame.

**2. Navigation affordances are unbalanced, and status sits far from them.** "Next →" carries a heavy black box in both desktop and phone frames while "← Previous" is bare text. If that's a persistent style it reads as a stray focus ring and breaks paper restraint; if it's a rendered focus state, the two controls still need visual parity. Give both the same treatment — either both plain text links with an underline on hover, or both in the same 1px rule box at equal width. Separately, the draft status currently appears twice at different distances: "We're still checking the layout; the complete PDF will follow." above the leaf, and "A few pages from your book. The complete PDF follows after the layout checks." below the navigation. Collapse to one, placed with the navigation where the creator's eyes end:

> Under the nav row, 12px below, 13px, muted:
> `Three earlier pages from your typeset draft. The complete PDF follows after the layout checks and arrives by email.`

Then shorten the top line to a single sentence: `A first look at your typeset book.` That removes redundancy and puts status within a glance of the controls, per the brief.

**3. Mobile scroll burden before the first line of writing.** On phone, the creator passes header, eyebrow, title, subtitle, a tall cover block, cover caption, "Read the first pages," the email line and "Keep this private link to return," then the tab row, then the section heading and its three‑line paragraph, then the toggle — roughly a full screen and a half before any of their own prose. When the Pages tab is active, the compact cover should tighten: cap the cover image at about 180px tall, and move the email/private‑link pair *below* the reader rather than above it. Also cut the mobile section paragraph to one line. That should recover 350–450px and let the leaf begin near the fold.

## Smaller notes

- In the reflowed text view, the trailing `1` renders as a final paragraph — a page‑number artifact leaking into prose. Suppress renderer page numbers in reflow, or render it as a small muted label outside the text block.
- Desktop leaf is roughly 860px tall with the lower third blank, because the real leaf is short. That's honest paper and I'd keep it, but the left column then ends around the leaf's midpoint, leaving a large empty gap at lower left. Consider letting the cover column stay sticky as the reader scrolls, or reducing the mat's vertical padding by ~24px so the columns end closer together.
- "COLLECTED WRITING" and "A synthetic browser fixture" on the cover are fixture strings; nothing here evidences how a real author's subtitle length or a long title will set.
- The tab label "The reading" wraps to two lines on phone while its siblings don't; a slightly narrower gutter or shorter label would even the row.

No extra gates are implied and none should be added — generation and delivery correctly precede any click.
