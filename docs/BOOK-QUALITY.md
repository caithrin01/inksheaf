# Book quality standard

What a reader may never see, surface by surface. The regression suite enforces the mechanical
subset; the cold read (below) enforces all of it. A book ships when a full cold read finds nothing.

## Cover
- Carries the publication's brand only. No Inksheaf mark anywhere on the front.
- Kind label names what the book actually is: Quarterly / Annual / Collected + the content noun
  (Essays, Letters, Recipes, ...), never a wrong noun.
- Foot: piece count in the right noun. No word counts, no spec-sheet data on the jacket.

## Title page and front matter
- No printer's mark; the imprint line lives once, in the back matter.
- Multi-author roster names principals (>=10% of pieces, min 2) and folds the rest into
  "with contributions from N others."
- The publication tagline is set as an epigraph, not an orphan fragment.
- No double-escaped entities anywhere (&amp;#x27; printing literally is a shipped bug).

## Table of contents
- Must be navigable. If titles are dates (letters publications), the TOC groups by month and each
  row carries the day plus a short excerpt; a list of bare dates is a failure.
- Bylines appear only where they inform: minority authors in a dominated book, everyone in a true
  group publication (no author over 50%).
- Section-titled publications group by section.

## Chapter openers
- Numerals only where enumeration means something; a 261-letter book gets dates, not "127".
- Byline shown when it differs from the dominant author.

## Body
- No platform boilerplate, no raw data blobs, no lost text at page breaks (suite-enforced).
- Verse ragged; embeds become source cards; dead images become honest boxes.

## Back matter
- Imprint appears here, once. Ordering instructions functional. QR codes to the publication first.

## The cold read (mandatory gate)
Before any coverage claim: open the rendered PDF and read cover -> first chapter end, and the back
matter, in three chairs: the AUTHOR (is my publication respected?), a GIFT RECIPIENT (do the first
five pages sell the object?), a COPYEDITOR (entities, spacing, casing, punctuation). Log findings;
fix; read again. Two consecutive clean reads = done. Claims of coverage are scoped to what was
actually read.
