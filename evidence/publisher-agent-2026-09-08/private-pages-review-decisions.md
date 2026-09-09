# Private page reader — review decisions, September 9

Actual OpenRouter critique: anthropic/claude-opus-5, 5,712 input / 2,302 output tokens,
$0.08611, completed with finish_reason=stop. Its raw response and receipt are saved here.
These are synthetic browser captures of a real three-leaf Typst/PDF.js fixture; the
owner's annual PDF remains held. Critique is not design approval or browser acceptance.

Applied:
- Separate the renderer's printed label from “Preview 2 of 3” on distinct lines.
- Shorten the top introduction; keep the draft/checks/email status by the page navigation.
- Tighten the active mobile reader cover to 180px tall, and move the existing email/private
  return controls below the reader in DOM order. Restore them beside the cover on desktop
  or when leaving Pages. Focus on a moved control is preserved.
- Keep The reading tab on one line at phone width.
- Expose the actual layout explanations from revised pages through See the layout adjustments.

Retained deliberately:
- The black box in the captures is the focused Next button, recorded after keyboard use.
  Both buttons already share styling. Keep the visible focus indicator and record its meaning.
- Keep the actual PDF's printed folio in text extraction for now. Removing a numeral without
  confirmed layout semantics could remove source text. The separate printed label makes its
  context visible. This is a small text-view refinement still available after release gating.
- The desktop cover already stays sticky. Keep real whitespace in this draft excerpt;
  whitespace acceptance of the complete annual PDF is a separate open gate.

Additional local inspection led to reflowed prose paragraphs, preserved line breaks for
poems/recipes/unclassified work, padding below the tabs, and opening directly into writing
rather than the contents. These are our implementation decisions, not findings invented
on behalf of the external model. Glyph text comes from the actual PDF, not a model rewrite.

Verification is recorded separately: real SQLite/private PDF API tests, Chromium/WebKit
phone/desktop, full unit suite, required renderer, source honesty, vault validator, and
current CI. Later captures after these refinements supersede the critique's static frames.
