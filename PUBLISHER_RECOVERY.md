# Completed PDF recovery

The publisher reserves every render and repair before starting work. A successful
build now saves an immutable private bundle before preview/review: exact PDF bytes,
measured pages and paragraph anchors, report, fit settings, original source figures,
and scraped branding. The journal reference binds it to the creator's selection,
requested edition and the render/repair reservation IDs witnessed by that builder.

A retry restores that bundle and repeats review under the current review policy.
It does not reserve a render merely to recover review. New repair work still uses
the original six-render/two-repair limit. Model calls, failed charges and unknown
reservations remain in the same $2/256-call edition journal. Complete responses
that fail schema validation get one correction attempt within those same limits;
invalid results are never silently truncated or cached.

Changed selections cannot reuse an old PDF. Changed edition inputs, incompatible
renderer policy, corrupted/missing bundles, a later unfinished render, failed
uploads and competing journal writes hold recovery. A reference is published only
after the private upload is acknowledged. A lost journal acknowledgement can be
recovered by reopening the authoritative state. Review-policy changes invalidate
old review verdicts independently of the saved PDF.

## Release prerequisite

Deploy the candidate's `services/proof_store.py` before releasing its press worker.
The new `/checkpoint` PUT/GET routes use the existing `inksheaf-proofs` secret with
separate upload/read HMAC purposes, content-addressed keys, a 150 MB limit and the
existing seven-day purge. Bundles never become reader/proof URLs and must never be
uploaded to public GitHub artifacts. The existing PDF routes remain available.

Local route tests and a simulated remote replacement worker pass. They do not
establish live Modal deployment, retention or worker-restart acceptance. The earlier
archive-relay deployment is a separate, already completed service change.

## Older held runs

Ordinary retry does not invent a checkpoint for a pre-checkpoint run. The retained
September 11 annual was explicitly reconciled locally: its recorded PDF digest,
all 158 printed-page geometries, original source hashes/order, renderer files and
last reserved fit-settings digest were checked before import. No render or charge
was removed. The original failed rehearsal result is retained separately from its
recovery results. This operator import is not a successful cold creator journey.

The first saved-artifact recovery scanned all 158 pages without rendering, then
held on an overlong confirmation note. Its invalid verdict remains unaccepted.
The subsequent bounded schema-correction fix has deterministic tests; it has not
yet completed another live annual review. The annual's final layout verdict and
all release/creator acceptance gates remain open. See the vault's launch execution
record for current ledger totals and the private evidence directory.

Further assessment found two distinct causes: empty paragraph end markers could
move to the following page, and bold label/value fields could form a chain of
sticky headings. Boundary review now asks for the specific defect and edge;
measured multiple lines or a complete source paragraph can contradict a claimed
single-line fragment, while headings, missing evidence and explicit uncertainty
remain held. The original model answer is retained in the audit. Bold field values
with explicit brace-delimited template values now paginate normally; real heading elements and standalone bold headings retain
their existing treatment.

The renderer correction changes the checkpoint renderer fingerprint. The older
private annual is retained as diagnosis, and normal recovery correctly holds its
older fingerprint. A corrected cold trial needs its own recorded development
allocation and fresh journal; it must not reset either exhausted run or be confused
with production/inbox acceptance. Current outcomes belong in the vault handoff.

The next cold trial at `fcfcbf2` retained all 22 expected pieces in 158 pages but
held during its second layout review: a six-page request used 4,695 of its 5,000
output tokens for thinking and returned incomplete JSON. Its 138 calls cost
$1.6705985, including the failed call; five renders and one repair remain counted.
Independent extraction passes source hashes, article-opening titles, physical
bounds and running matter, but finds one remaining reading-order interruption.
The final layout verdict is incomplete, so this is not cold-book acceptance.

That trial also exposed the overbroad colon-field rule: ordinary titles containing
a colon lost their heading attachment. The correction is restricted to explicit
template values, with real page-turn regressions for both colon styles. A legible
monochrome emoji is no longer described as a font defect merely for lacking colour.
Layout requests now specify a 2,048-token thinking budget within the unchanged
5,000-token completion limit and six-page batch. This uses OpenRouter's documented
[`reasoning.max_tokens`](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
control. Local tests verify the request and preservation of a truncated charge
across restart; live provider compliance and completed quality review remain open.
Incomplete answers still hold without being accepted or cached. No new paid trial
was started after these corrections.

The subsequent source-position regression reproduces a first screenshot floating
past later sections without intersecting a paragraph. Figures now retain the ID
of the following source paragraph and its article. Printed line measurements
detect delayed figures, which the fitter places in flow before paid review.
Whitespace failures share that same next reserved render. A real two-render
fixture preserves both images and every source marker.

The live six-page probe **did not honor the numeric thinking limit**: it used all
5,000 tokens for reasoning and held ($0.107472). Explicitly disabling optional
reasoning returned all six decisions in 8.6 seconds with zero reasoning tokens
($0.062192). Both calls remain in one journal, $0.169664 total. Layout now uses
`reasoning.enabled: false`, still with six-page batches and 5,000 output tokens.
That request success is not quality acceptance: a model's attempt to excuse a
two-line prose tail exposed a missing validator check. Sparse multi-page prose
endings with fewer than 25% ink rows and no figures now require repair or a hold;
poems, recipes and complete single-page pieces retain their distinct treatment.

Source paragraph types and endings also distinguish complete body text from
isolated headings. A heading claim is contradicted only when the complete body
paragraph's final printed line matches its source ending. Real headings,
unmatched lines, uncertainty and missing evidence retain their hold. Private
source tails are used locally for matching and omitted from model anchor packets.
New cold acceptance results belong in the vault; all old trial results and costs
remain retained.

The ea29120 cold annual retained 22 pieces / 36,001 source words in 154 pages,
with zero measured reading-order findings and passing independent source/title,
bounds and running-matter checks. It still held: 183 calls, six renders, two
repairs, $1.81615625 known and $1.837507 including one unresolved provider charge.
Its next layout request could not reserve within $2. No limits or prior evidence
were reset, and the title/screenshot concerns prevent accepting that PDF.

The follow-up keeps words whole in article/section display titles and identifies
QR captions in labelled Links sections as intentional print apparatus. Unknown
image roles now use the existing bounded column reading size: absent alt text
cannot justify shrinking a screenshot. Model and automatic shrinking candidates
require a known picture role; enlargement remains available when review finds
unreadable detail. This can increase page count for images without descriptions.

Only the renderer's explicit spacing-only exit (4), with complete measurements,
can enter the normal publisher review despite its blank-page gate. Both press and
rehearsal opt into this path; every >30% gap still needs an explicit layout
verdict. Compile, glyph and measurement failures still stop. A real regression
keeps the source image at 300pt, preserves its three source markers, and proves a
compile error cannot use stale spacing data to enter review. Checkpoints retain
the unresolved-spacing flag. This flag is never a completed-book verdict.

Layout requests keep thinking disabled and reserve 600–2,500 output tokens for
one to six short schema-bound decisions. Incomplete output still holds and is
charged. The local 158-page size diagnostic reuses the held selection and fit
settings; it is not a new cold acceptance or a continuation of the spent journal.

The next cold annual on ec5ea2a completed its requests but remained held: 158
pages, 22 pieces, 141 calls, six renders, two repairs and $1.85020375. Independent
source/title/bounds/folio/image-order checks passed. Its PDF and journal remain
unchanged. This is not cold completion.

A focused diagnosis exposed body pages misidentified as article endings, missing
visual composition context, and a legible monochrome cake mistaken for a missing
glyph. The follow-up gives layout review labelled previous/current/next PDF pages
in three-target batches. Cache identity includes their bytes. Compiled spans and
validated space-basis choices reject an article-end exception on a body page;
all measured gaps still require a factual decision. Hash-bound private request
and result files are written before quality holds or repair exhaustion, without
publishing source text or local paths. The press retains the pending-spacing flag.

Glyph confirmations can receive up to eight magnified crops from the actual PDF,
along with its character/font records. A nonzero glyph never clears a finding by
itself; source comparison images keep priority within the four-image limit.
Actual emoji, missing-glyph and unresolved-symbol fixtures exercise this path.
Two normal-packet requests ($0.059194 total) returned structurally consistent
figure/end-matter decisions and dismissed the cake misidentification. These are
focused diagnostics, not another annual or permission to overwrite a held verdict.
See evidence/publisher-layout-evidence-2026-09-11/results.json.
