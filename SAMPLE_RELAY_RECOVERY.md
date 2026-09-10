# Production sample reader recovery — 2026-09-10

Release `11bb5da` serves the larger wordmark, subtle screen gradients and private publisher journey. GitHub run 34508001585 deployed successfully but finished red: the production browser gate passed 11/12 journeys and could not open the public text sample. A second real browser run reproduced it. `/api/sample?url=caithrin.com` returns 422; the prepared Modal sample endpoint still returns 404. The candidate gate passed because direct public reads work from its runner, unlike Cloudflare egress.

This brings the unmerged PR #2 relay implementation onto current main. Known relayed publications use their existing working origin; direct reads can fall back. HMAC signatures bind the cached host, public post ID, slug and five-minute bucket. Both ends check identity, public audience and bounded responses. The original Substack logo survives relay metadata and versioned caches refresh. Error messages now describe the current free-PDF action.

Local validation: 22 public-sample/design assertions, eight relay tests, 21 archive-paging checks, 13 signed-cache checks, publication identity and edition-preview fixtures, build and validator. GitHub runs the full acceptance suite. No renderer or visual design changed.

## Deployment dependency

The previous automatic approval rejection for a direct Modal update remains unresolved. It required explicit owner authorization for that infrastructure deployment outside the protected GitHub site workflow. Do not merge/release this change until `python3 -m modal deploy services/archive_relay.py` is authorized and the new endpoint passes authenticated public reads. Site deployment must still use the protected GitHub workflow. No author emails, generated public books, listings or orders are part of this repair.

## Repeatable contract check

The temporary probe referenced by earlier vault notes did not survive restart. Its replacement
is `node scripts/check-sample-relay.mjs`, optionally with `--out <local-evidence.json>`. Run it
after the specifically authorized service update. It reads the existing relay credential
without printing it, requires a bad signature to return 401, checks the identified owner public
post, and compares the relayed body hash with a direct reference. Output contains status, public
post ID and body hash only. Requests reject redirects and bound time/bytes. Four injected-fetch
checks cover success, a missing endpoint, changed body and paid content; the live check remains
pending. Use `python3 -m modal deploy services/archive_relay.py`; the older stop-first helper
would introduce an unnecessary service interruption.
