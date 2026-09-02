# Random-publication battery, 2026-09-01, seed 29805137

Engine chromium, base https://inksheaf.com, 4 publications drawn from Substack's public category listings (1 on custom domains).
Result: FAIL: 2 pass, 0 degraded, 2 fail, 0 unknown; p95 7.1s, slowest 7.1s.
Repeat with `node scripts/test-random-substacks.mjs chromium https://inksheaf.com --n=4 --seed=29805137`.

| # | host | pasted as | independent read | page outcome | s | verdict | note |
|---|---|---|---|---|---|---|---|
| 1 | www.misspolitica.club | `  https://www.misspolitica.club  ` | empty | "There are no public essays to preview from the last year. Jo" | 7.1 | PASS | empty, said so |
| 2 | unpackwithmehak.substack.com | `unpackwithmehak.substack.com` | book 78p | book: Your archive is already a 280-page book. | 5.4 | FAIL | posts 76 on page, 78 in the independent read |
| 3 | stringmusic.substack.com | `  https://stringmusic.substack.com  ` | book 25p | book: Your archive is already a 86-page book. | 5.4 | PASS | 25 posts, 13837 words |
| 4 | rektoverso.substack.com | `https://rektoverso.substack.com/p/uncloseted-first-post?utm_source=share` | book 49p | book: Your archive is already a 198-page book. | 5.7 | FAIL | posts 47 on page, 49 in the independent read |

## Not covered

- Publications not in Substack's category listings (unlisted, private, or brand new)
- Paid-only archives with an export (the page cannot see them; truth here is the public list only)
- Touch hardware, screen readers, and the signup after the book (journeys A2, A4, A12 cover those on fixed hosts)
- An outage that starts mid-read: each publication is read once, at the moment it was drawn
- Non-Latin publication names in the masthead and cover (recorded, not judged)
- The stale-cache path when the base has no D1 (local runs read cold every time)
