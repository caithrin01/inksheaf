# Restoration critique decisions — September 9

One actual Opus 5 call completed at $0.08192 (7,629 input / 1,751 output tokens). These are synthetic UI fixtures, not production delivery or annual PDF acceptance.

Applied: keep the model’s original exclusion reason and source quote after a creator restores the piece, including after the worker replays the reading. The status remains “Kept by you.” Fixed the saved-row divider spacing by keeping the decision’s whole row together and removing a negative margin. Changed screenshot setup to instant scroll-to-top: global smooth scrolling had left the mobile heading under a sticky tab while a capture was taken.

Behavior questions are covered separately by browser tests: the restore control is a real button with a 44px minimum height; failed-save retry, repeat-click protection and keyboard activation work; the saved choice survives reload; stale contents are disabled until the revised reading/contents arrive; open rows are retained through that transition. A static critique is not proof of those behaviors.

The review’s broader observations about clerical model language, rendered-page browsing and the unfinished print handoff remain open. No fake preview, dummy undo control or new listing was added. The final small fixes passed the refreshed Chromium/WebKit phone and desktop browser checks. Direct inspection confirms that the saved-state divider and mobile heading are now clear. This inspection and the browser tests are separate from the earlier external critique.
