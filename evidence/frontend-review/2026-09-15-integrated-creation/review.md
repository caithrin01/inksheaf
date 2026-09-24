## What the screenshots actually show

The typographic voice is consistent and calm, the excerpt block is the strongest thing here — verbatim source text in a large serif, with the piece's title above it, is genuinely rewarding and unmistakably the creator's own writing. On phone (image 2) real sentences appear roughly one screen-and-a-bit down, which is acceptable. I can't judge the one-minute path, motion, keyboard access or email delivery from stills, and image 3 is a fixture render, not a delivered or accepted book.

## Four issues

**1. The cover identity changes between the two states.** In progress the cover reads *"Don't worry about the vase — letters on art, life, and the things we keep"* with caption "Classic cover"; the finished state shows *"The things we keep"* with "Masthead cover." As a reader of the two screens in sequence, that looks like a different book, which undercuts the "recognizably yours" claim at the exact moment trust matters. Suggestion: lock the cover template and title string chosen at signup for the whole session, and if the masthead cover truncates the long title, truncate visibly rather than silently — e.g. render the full title at a smaller size in the finished cover, or append a subtitle line, and drop the template name from the caption (keep only `6 × 9 inches`) so the label can't read as a switch.

**2. "6 of 8 pieces read" is printed three times in one viewport.** Heading subline, panel heading, and the tab's own content all repeat it (both images 1 and 2). Suggestion: keep it once as the panel heading and change the subline under the H1 to the thing the reader can't otherwise see — `Reading your writing. The rest is on its way; nothing more is needed from you.` This also answers the "repeated demands" worry explicitly.

**3. Set-aside items ask for decisions twice, inline, in the middle of reading.** Two "Put this back in the book" links interrupt the list before the creator has seen the book at all. Suggestion: collapse both into one line beneath the list — `2 pieces set aside as housekeeping. Review them →` — and keep the per-item reason inside the existing `+` disclosure. Nothing on this screen should be required before the PDF exists.

**4. In the finished state the complete PDF is not the clear next action.** "Read your book," three tabs, a volume picker, a page picker, a Printed/Text toggle and prev/next all precede the two download buttons at the bottom of a long phone scroll; the "Email delayed" notice sits below them. Suggestion: promote a single primary action directly under the cover — `Download your complete edition (2 volumes · 28 pages)` — and move the delivery notice up next to it. Concretely, on the finished view:

```css
.finished .primary-download { position: sticky; bottom: 0;
  padding: 12px 16px; background: #faf9f5;
  box-shadow: 0 -1px 0 rgba(0,0,0,.08); }
.finished .page-preview { margin-top: 32px; } /* browsing is secondary */
```

and retitle the browser section `Look through the pages first (optional)` so it reads as a choice, not a step. Also fix the desktop left column (image 1): the cover sits above ~500px of empty space; `align-self: start` plus moving the email line and private-link directly under the caption would close the gap.

Unverified by these images: timing, delivery, acceptance, responsiveness beyond these two widths, and print fidelity.
