## Observations

**Identity and tone.** The quiet-paper look holds across all four frames: same off-white ground, same cover thumbnail, full publication title carried intact in the cover art, the reading list and the print state. The restore control's language ("Put this back in the book") sits comfortably beside the editorial prose — it reads like a note in a margin rather than a form control, which suits the product. Placement is also right: the control appears *under* the set-aside reason, so the justification is read before the reversal is offered. Only two rows carry it, and only the excluded ones, so the list stays calm.

**Spacing.** Desktop rows breathe well; the set-aside rows are visually recessed via lighter title colour, which does the exclusion work without badges. Mobile stacking of title/tag/toggle is legible, and two-line titles wrap cleanly with the tag holding its right column.

## Three actionable issues

1. **The confirmation line is clipped and collides with the row rule (Image 3).** "Kept by you." sits tight against the divider under "Thank you for 1,000 subscribers" and its descenders appear cut. This is the single moment the user needs to trust — the one visible payoff of the save — and it currently looks like a layout accident rather than a result. It needs its own vertical space in the same slot the set-aside reason occupied, with the divider pushed below it.

2. **Restoring erases the reason, so the decision stops being inspectable.** In Image 3 the restored row's "Set aside · Administrative post regarding subscriber milestones…" is replaced outright by "Kept by you."; by Image 4 the row is indistinguishable from any always-included piece. That contradicts the "open a title to read the reason and its source" promise and removes the trail the owner would need to reconsider or to understand why the AI had excluded it. Consider keeping the original reason available inside the expanded row, with "Kept by you" as the status line above it.

3. **Mobile heading appears truncated in the pre-restore state (Image 2).** A sliver of cut text sits directly above "6 for the book, 2 set aside", where Image 3 shows a full "8 of 8 pieces read." heading. If that is a clipped heading under the sticky tab strip rather than a capture crop, the count — the thing the restore action changes — is unreadable exactly when the user is deciding.

## Behaviour questions (not provable here)

- Is the restore control a real button, or a link-styled element? It is visually identical to "Keep this private link to return", which is navigational — the affordance doesn't distinguish a state-changing action from a link.
- Image 3 says old contents are disabled while rebuilding, but the Contents tab isn't captured in that state; disabled styling, focus handling and the returning-to-tab experience are unverified.
- Nothing in Image 4 links the revised count (7/1, 42 pages) back to the restore event, so I can't tell whether the worker's revised contents are surfaced as a change or silently swapped.

## Overall

The interaction is well-judged: one optional, plainly worded control, no modal, no mandatory confirmation, and the count sentence doing the accounting. It genuinely feels like editing a book rather than toggling a record. The weak point is the after-save moment — clipped, terse, and it discards the model's reasoning, which is the same inspectability gap already open elsewhere in your backlog. Fix that slot and this checkpoint is close to done.
