# Production sample reader recovery — 2026-09-10

Release `11bb5da` serves the larger wordmark, subtle screen gradients and private publisher journey. GitHub run 34508001585 deployed successfully but finished red: the production browser gate passed 11/12 journeys and could not open the public text sample. A second real browser run reproduced it. `/api/sample?url=caithrin.com` returns 422; the prepared Modal sample endpoint still returns 404. The candidate gate passed because direct public reads work from its runner, unlike Cloudflare egress.

This brings the unmerged PR #2 relay implementation onto current main. Known relayed publications use their existing working origin; direct reads can fall back. HMAC signatures bind the cached host, public post ID, slug and five-minute bucket. Both ends check identity, public audience and bounded responses. The original Substack logo survives relay metadata and versioned caches refresh. Error messages now describe the current free-PDF action.

Local validation: 22 public-sample/design assertions, eight relay tests, 21 archive-paging checks, 13 signed-cache checks, publication identity and edition-preview fixtures, build and validator. GitHub runs the full acceptance suite. No renderer or visual design changed.

## Deployment dependency

The owner explicitly approved the Modal update on September 10. Deployment completed and live
contracts passed: bad signatures return 401, the signed public owner sample returns 200 with
the direct source's body hash, and slim archive metadata preserves the publication name/logo
without post bodies. PR #8 merged as `0a0e6a8`.

Protected release `34532863814` then stopped before migration/deployment: Chromium's real-read
journeys passed 12/12; WebKit failed an immediate frame-URL lookup after iframe visibility.
The test now delays the reader document by 350ms and waits for visible paragraph content in
that iframe before checking its URL and both cleared loading messages. The old assertion
reproduces the race; corrected real-read Chromium and WebKit journeys each pass 12/12.
PR #10 merged as `d30f0aa`; protected release `34535983027` passed, including 12/12 production
journeys. The deployed commit, sample body and publication logo were verified against their
sources. Site deployment still uses the protected GitHub workflow. PDF candidate PR #9 remains
separate. No author emails, generated public books, listings or orders were part of this repair.

## Repeatable contract check

`node scripts/check-sample-relay.mjs`, optionally with `--out <local-evidence.json>`, reads the
existing relay credential without printing it, requires a bad signature to return 401, checks
the identified owner public post, and compares the relayed body hash with a direct reference.
Output contains status, public post ID and body hash only. Requests reject redirects and bound
time/bytes. Four injected-fetch checks cover success, a missing endpoint, changed body and paid
content; the live check passed after the approved deployment. The deployment command was
`python3 -m modal deploy services/archive_relay.py`; the older stop-first helper would introduce
an unnecessary service interruption.
