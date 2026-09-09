## Overall read

The quiet typography/paper direction is holding — ivory ground, one serif for the book object, sans for chrome, and no gradients or badges shouting. It feels closer to a private press proof than a SaaS dashboard, which is the right instinct. The cover with the deliberately long title survives four lines without shrinking to unreadability, and the "8 of 8 pieces read" line plus per-piece reason + quoted source line is genuinely the delightful part: it's the one place the product proves it read the real writing rather than counted files.

Where it tips bureaucratic: the eight editorial rows are visually a ledger — uniform 63px rules, right-aligned label, `+` affordance — so the *outcome* (six kept, two set aside) never registers as a decision, only as a table. And I can't judge the typesetting "watch" moment, event timing, keyboard access or the 42-page fixture from stills; the Contents pane in image 3 is captured mid-fade, so I can't tell whether it's a transition or a disabled state. Not production-ready on this evidence.

## Five issues

**1. "Set aside" is masquerading as a genre.** In the right-hand slot, `essay`, `poem`, `interview`, `recipe` (lowercase, grey) sit in the exact same position as `Set aside` (capitalised, grey). Two different axes — classification vs. inclusion — share one column, so an excluded piece looks like it has a genre called "set aside," and the two exclusions don't visually recede from the six keepers. Nothing on the collapsed row says *why*.

Give exclusion its own axis and a visible reason stub:

```css
.row[data-state="aside"] .row__title { color:#6b6a64; }
.row[data-state="aside"]::after {          /* left flag, not a right badge */
  content:""; position:absolute; left:-14px; top:1.15em; bottom:1.15em;
  width:2px; background:#c9c5b6;
}
.row__genre { font-variant:small-caps; letter-spacing:.06em; color:#8a887f; }
.row__aside { font-style:italic; color:#6b6a64; text-transform:none; }
```
Copy: replace `Set aside` with `set aside — a subscriber notice, not writing` and `set aside — housekeeping post`. Header: `8 of 8 pieces read · 6 for the book, 2 set aside`.

**2. Cover geometry: title block floats, lower third is dead.** Inside the rule the four-line title ends around 48% of the height, the date sits at ~58%, then there's a ~300px void before "Alex Example". Classic title pages hang the block from the upper third *and* let the byline anchor a visible baseline — right now it reads as a rendering accident, and on a real 6×9 trim the imbalance will be worse.

```css
.cover__plate { display:grid; grid-template-rows: auto 1fr auto auto; padding:8% 10% 9%; }
.cover__kicker { align-self:start; }
.cover__title  { align-self:center; margin-top:-4%; }   /* optical, not geometric, centre */
.cover__dates  { margin-top:1.1em; }
.cover__author { margin-top:0; }                         /* let 1fr absorb slack above */
.cover__title  { text-wrap:balance; hyphens:none; }
```
Also test the long title at 5 lines: cap with `font-size:clamp(1.35rem,4.4cqi,1.85rem)` inside a `container-type:inline-size` plate so the 6×9 ratio is what shrinks the type, not the viewport.

**3. Phone: the work is below the fold twice over.** On image 2, roughly 830px of cover art, dimension caption, email line and "Keep this private link" precede the tab bar; the first editorial row lands around 1220px. The reason-and-quote payload — the thing worth seeing — needs three-plus screens of scrolling.

On viewports under 700px, shrink the cover to a peek and move the receipt copy below the list:

```css
@media (max-width: 700px) {
  .cover-figure { max-height: 44vh; }
  .cover-figure img, .cover__plate { height:100%; width:auto; margin-inline:auto; }
  .cover-meta, .cover-email { order: 9; }        /* after the tabs/list */
  .tabs { position:sticky; top:0; background:#faf9f4; z-index:2;
          box-shadow:0 1px 0 #e5e2d6; }
  .row { padding-block:.85rem; }
}
```
And let the row title and genre share a line rather than wrapping to two: `.row{display:grid;grid-template-columns:1fr auto auto;column-gap:.75rem;align-items:baseline}` with `.row__title{text-wrap:pretty}`.

**4. Desktop wastes the whole right column below the list.** In images 1 and 3 the left cover column runs ~700px tall while the right column ends and leaves 200–800px of empty ivory; in the Contents view the imbalance is severe (a six-item list against a full-height cover). Nothing tells me what happens next on the desktop reading state — no "typesetting begins when the reading finishes" line, no progress anchor.

Let the columns breathe unequally and pin a quiet status footer under the list:

```css
.workspace { display:grid; grid-template-columns: minmax(320px,0.85fr) 1.15fr; gap:4rem; align-items:start; }
.cover-figure { position:sticky; top:2rem; }
.panel__footnote { margin-top:2rem; padding-top:1rem; border-top:1px solid #e5e2d6;
                   font-size:.875rem; color:#6b6a64; }
```
Copy for that footnote in the reading state: `Six pieces will be grouped and typeset next. Nothing is final — you can restore a set-aside piece before the PDF is made.` In Contents, add the retained/excluded count and section names so the pane earns its height.

**5. The PDF-ready state mixes read/save/expiry/delay into one paragraph, and the delayed email has no action.** Image 4 stacks: a button labelled "Read your complete PDF ↗", then "Save your PDF. These private download links work until December 31.", then "Your PDF is ready here. Its email to owner@example.com is delayed; we're following up," then the private link, then "42 pages" repeated a third time. That's four adjacent claims about one file, and the one thing a creator would want — resend, or change the address — isn't offered. The delay is also stated but not dated, so it reads as an apology rather than a status.

Restructure as one primary, one secondary, one status:

```
Your complete edition · 42 pages

[ Download the PDF ]   Open in a new tab
Private links stay live until 31 December.

Email — delayed
We haven't got your copy to owner@example.com yet and are retrying.
Nothing is lost; the PDF above is the same file.
[ Resend now ]  [ Use a different address ]
```
```css
.status { border-left:2px solid #c9a227; padding-left:.9rem; }  /* muted, no coloured panel */
.status__label { font-variant:small-caps; letter-spacing:.06em; color:#6b6a64; }
.actions { display:flex; gap:1rem; flex-wrap:wrap; align-items:baseline; }
.btn--ghost { background:none; border:0; text-decoration:underline; text-underline-offset:3px; }
```
Drop the second "42 typeset pages" sentence under the list, and keep "Make it yours" / "Get help with printing" where they are — they're appropriately quiet and don't pressure the optional Lulu path.

## Not verified here

Motion of the typesetting sequence, live event ordering, keyboard/focus order on the `+` disclosures and tabs, whether the Contents fade is a transition or a stuck state, real 42-page pagination, actual inbox delivery, and print fidelity of the cover plate at trim. Those need the Chromium/WebKit runs, the axe pass, the production renderer checks and a real proof.
