# Publication logo background correction

The owner liked the Inksheaf style guide, then rejected its publication-logo backgrounds:
"the logo blends on one and sticks out on the other 3 and looks terrible".
The original Substack PNG has an opaque charcoal ground. A padded square plate did not solve it.
Review this focused correction; the surrounding identity, typography, subtle paper and book
geometry are already the current direction. This is a standalone style guide before site work.

We found the owner's existing canonical vector masters in their caithrin-brand repository.
They are copied byte-for-byte, have identical path geometry and no background rectangle.
Default: charcoal master on ivory Classic and pale-green Field notes; gold master on black
Masthead and navy Midnight. These are verified owner assets, not automatic background removal
or an invented publication mark. Personal caithrin artwork is used only for that publication.

Fallback demo: preserve the opaque Substack PNG inside a full-width charcoal publication band
at the foot, with publication name and domain. The band colour is the actual corner RGB of
the source (29,30,29). This is a proposed fallback for flat opaque backgrounds; complex/photo
logos stay intact and require a composed treatment during proofing. Removing a background or
creating a one-colour adaptation needs author proof review. The default is transparent artwork.
Also corrected the stepped right edge on Field notes' title block: it now bleeds full-width.

Current browser checks pass in Chromium/WebKit at 1440 and 390px: all three treatments load,
6x9 ratio, bounds, Field full bleed, no substituted logo for unrelated publications, missing
logo fallback and zero axe WCAG A/AA violations. These don't establish aesthetic or print approval.

Inspect the four labelled captures. In at most 350 words: does the default solve the pasted-on
square problem, is the fallback composed rather than a floating sticker, and is there a material
remaining visual defect? Distinguish visible defects from taste and from print-size limits.
The mark has fine lines in the original identity; don't claim a screen capture proves print quality.
