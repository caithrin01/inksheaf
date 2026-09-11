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
now paginate normally; real heading elements and standalone bold headings retain
their existing treatment.

The renderer correction changes the checkpoint renderer fingerprint. The older
private annual is retained as diagnosis, and normal recovery correctly holds its
older fingerprint. A corrected cold trial needs its own recorded development
allocation and fresh journal; it must not reset either exhausted run or be confused
with production/inbox acceptance. Current outcomes belong in the vault handoff.
