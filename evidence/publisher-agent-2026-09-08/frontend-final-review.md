## Overall read

The quiet paper direction is working — this looks like a press proof, not a SaaS dashboard, and I'd keep the palette, the serif list, and the hairline rules exactly as they are. The delight is real in two places: the cover with the creator's own long title actually set on it, and the open poem row where the decision shows a quoted line from the piece. Everything else drifts toward the bureaucratic end: rows of categorised titles with clerical prose, and a final state that reads like a receipt. The gap between those two registers is where the fixes are.

Caveat: these are static shots. I can't judge the typesetting animation, live email delivery, tab keyboard behaviour, touch target sizes, or whether the 42-page PDF matches the list — the fixture note makes clear it doesn't yet. Nothing here should be called production-ready.

## Five issues

**1. Cover vertical geometry is bottom-hollow (Images 1, 3, 4)**
Inside the ruled frame, the title block sits high, the date rule follows immediately, and then there's a large dead field before "Alex Example" at the foot. On the 4-line long title the top half is dense and the bottom third is empty — the plate looks unbalanced rather than composed. The "COLLECTED WRITING" eyebrow also sits very tight to the top rule compared with the author's clearance at the bottom.

```css
.cover-plate{
  display:grid;
  grid-template-rows:auto 1fr auto;   /* eyebrow / title block / author */
  padding:8.5% 9% 9%;
  aspect-ratio:6/9;
}
.cover-eyebrow{ margin-bottom:0; }
.cover-titleblock{
  align-self:center;                   /* optical centre of the free field */
  transform:translateY(-4%);           /* nudge above true centre */
}
.cover-title{
  text-wrap:balance;
  letter-spacing:-0.006em;
  line-height:1.14;
  font-size:clamp(15px, 2.05vw, 25px); /* step down at 4 lines */
}
.cover-title:has(> span:nth-child(4)){ font-size:clamp(14px,1.85vw,22px); }
.cover-rule{ margin:0.9em auto 0; }
```
Also cap the title at four lines with an ellipsis rather than letting a longer fixture push into the date rule.

**2. On the phone, the work is below the fold twice over (Image 2)**
Cover art, size caption, email sentence and return link occupy roughly the first two-thirds of the viewport before "The reading" tabs appear. The creator has to scroll past static packaging to reach the thing they came to see — their writing being sorted. Then eight rows plus two explanation blocks means the retained list runs several more screens.

```css
@media (max-width:600px){
  .cover-stage{ max-width:190px; margin-inline:auto; }   /* from ~full width */
  .cover-meta{ font-size:13px; }
  .cover-meta .email-line, .cover-meta .return-link{ display:none; }
  /* re-expose both in the final state / a "Delivery" disclosure */
}
```
Alternatively, order the mobile column: heading → tabs + reading list → cover → delivery. The cover is a reward; the classification is the story.

**3. Heading collides with the tab rule on mobile (Image 2)**
"8 of 8 pieces read." sits hard against the tab underline — it looks like a spacing bug, not restraint.

```css
.tabpanel{ padding-top:28px; }
.tablist{ margin-bottom:0; border-bottom:1px solid var(--rule); }
```

**4. Set-aside rows are explained clerically, and offer no way back (Images 1, 2, 4)**
The poem row is lovely: a plain reason plus a quoted line from the source. The two exclusions get the opposite treatment — grey title, no quote, and prose like "Administrative post regarding subscriber milestones and publication schedule." That's a compliance note about a person's writing. Exclusions are also the rows most likely to be contested, and there's no inline restore; the only path is "Adjust this edition" at the very bottom of the final state.

Copy, per set-aside row:
> **Set aside** — this reads as a note to subscribers rather than a piece of writing.
> "Thank you all — we crossed 1,000 subscribers this week."
> [Put this back in the book]

```css
.row--aside .row-title{ color:#6b6862; }            /* keep, but add the badge */
.row--aside .badge{
  font:500 10px/1 var(--sans); letter-spacing:.09em; text-transform:uppercase;
  border:1px solid var(--rule); padding:3px 6px; border-radius:2px;
}
.row--aside blockquote{ border-left:2px solid var(--rule); padding-left:12px; }
.row-restore{ font-size:13px; text-decoration:underline; margin-top:8px; }
```
Give every row the same evidence shape — reason + quote — so retained and excluded feel judged by one standard.

**5. The final state buries the delay and repeats the page count (Image 4)**
"Your PDF is ready here. Its email to owner@example.com is delayed; we're following up." is set as body text below the download button, in the same weight as the expiry note — the one piece of bad news is the least visible thing. "42 pages" then appears in the subtitle, again as "42 typeset pages" after the list, and the Lulu paragraph closes the page with three sentences of logistics. Also "work until December 31" gives no year and no relative sense.

```css
.delivery-notice{
  border-left:2px solid #8a8378; padding:10px 0 10px 12px; margin:16px 0;
  font-size:14px;
}
.delivery-notice strong{ font-weight:600; }
```
Copy:
> **Email delayed.** Your PDF is ready to read here now. We're still trying to send it to owner@example.com. [Retry email] · [Change address]
>
> Download links stay live until 31 December 2026 (about six months).

Drop the second "42 typeset pages" line, or change it to something with craft in it: "Measured and fitted — 6 pieces across 42 pages." And compress the Lulu block to one sentence plus the existing link.

## Two smaller notes

- The reading panel repeats the book title at large size directly beneath a cover that already shows it, then adds "Writing by Alex Example." On desktop this is the second-loudest element on screen and competes with the piece titles. Reduce to ~15px, or drop it entirely on desktop where the cover is adjacent.
- The `+`/`−` glyphs and lowercase genre tags sit close together at the right edge; whether the hit areas are adequate isn't something these shots can show. Worth confirming the whole row is the toggle, with the tag non-interactive.
