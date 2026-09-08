# Owner's second physical copy

The private acceptance run prepares one caithrin.com copy: 22 selected essays, 142 pages,
Masthead cover, 6×9 black-and-white perfect-bound matte, standard MAIL shipping, quoted
at $12.46 including shipping, fulfillment and tax. Private artifacts remain under ignored
`output/private-acceptance/owner-order/`.

The user confirmed the prior Mox delivery address and approved the five owner PDF exports
and six-image OpenRouter critique on September 7. Total new spending must remain below $50.
The one-copy job has been submitted; current order state is in the ignored private artifacts.
Do not create another job when repeating checks. The earlier export rejections are resolved
by that explicit confirmation; the separate Modal service deployment remains unapproved.
No third-party proof uploads, author messages, public listings or additional copies are authorized.

Local inspection (no network or payment):

```sh
node scripts/live-hero/owner-order.mjs
node scripts/live-hero/test-owner-order.mjs
```

After explicit PDF-upload authorization, validate the current interior and all four owner
covers and refresh the quote:

```sh
node scripts/live-hero/owner-lulu-preflight.mjs --validate --quote
```

After successful validation, review the exact current PDF hashes and confirm the prior delivery
address. Only then use the one-copy submission:

```sh
node scripts/live-hero/owner-order.mjs --submit --address-confirmed
```

The submission uses the fixed reference `inksheaf-dogfood-002-20260907`, an exclusive local
lock, exact PDF hashes, all five live validation statuses, a fresh quote capped at the reviewed
total, and prior-address comparison. It records intent before its single create call. It does
not upload files, create a listing, change payment settings, or deploy infrastructure.

Lulu documents `search` across several fields, including external references, in its
[official API specification](https://api.lulu.com/api-docs/openapi-specs/openapi_public.yml).
The script searches every returned page and then requires an exact reference match; it does
not assume a dedicated external_id query parameter or server-enforced uniqueness.

If the create call has an ambiguous result, the script records it and refuses automatic
resubmission. A later invocation can reconcile a matching existing job, but an empty search
does not prove the previous attempt failed. Inspect any surviving lock or unknown-outcome
state; never delete state merely to make the command run again.

Record the job ID, actual status and charged cost. Creating a job is not evidence of payment
or shipping: if Lulu returns UNPAID, complete the authorized one-copy payment through the
existing account and confirm its status. Do not add another job or enable account-wide
automatic payment just to finish this order.

The separate Modal relay deployment and protected GitHub production release remain separate
from this owner-only print operation.
