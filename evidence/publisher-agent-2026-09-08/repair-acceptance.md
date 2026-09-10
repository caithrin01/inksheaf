# Targeted real publisher repair

September 9: the owner’s illustrated Byron essay passes the shared application pipeline after
two model-directed repair rounds and five render passes. The final 18-page artifact has no
confirmed visual or measured reading-order findings. Sparse leaves have page-specific reasons.
Source body hashes remain unchanged. Local visual inspection confirms the portrait/text order
and the shared reference/edition-note leaf.

The initial automated 18-page pass was insufficient: the model missed images interrupting
paragraphs. Typst now records paragraph start/end and figure positions; code identifies these
interruptions even when the scan returns no findings. The publisher selects measured in-flow
repairs, and the renderer retains source image size/bytes while moving them to their original
position. A compiled regression fixture detects the bad float and clears its repaired variant.
Short bold source headings remain with the following block. A short collected reference can
share the edition-note leaf instead of forcing a mostly empty page.

A position repair can expose a figure gap. Unused render passes now remain available to the
deterministic fitter within the six-pass limit per volume attempt and two model repair rounds.
This is still bounded; retrying an edition preserves the shared inference ledger.

The required browser renderer gate had a test-server port collision with an existing workerd.
It now requests an available port from the OS and waits for binding. That process was left alone.
The current required gate is 69/0; Typst 35/0, layout 13/0, orchestration 6/0.

Cumulative development cost for this targeted rehearsal is $0.293589, or $0.496861 including
unknown-charge reservations. It includes the failed attempts and resumes, not a fresh-job cost
estimate. Final private evidence is in owner-single-article-pipeline.json. The full annual
edition has not yet passed these newer checks. No PDF was emailed, uploaded, listed or ordered.
