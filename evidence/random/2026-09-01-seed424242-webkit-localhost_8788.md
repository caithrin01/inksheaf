# Random-publication battery, 2026-09-01, seed 424242

Engine webkit, base http://localhost:8788, 15 publications drawn from Substack's public category listings (3 on custom domains).
Result: PASS: 13 pass, 0 degraded, 0 fail, 2 unknown; p95 18.6s, slowest 18.6s.
Repeat with `node scripts/test-random-substacks.mjs webkit http://localhost:8788 --n=30 --seed=424242`.

| # | host | pasted as | independent read | page outcome | s | verdict | note |
|---|---|---|---|---|---|---|---|
| 1 | www.qasimrashid.com | `https://www.qasimrashid.com/p/decisiondeskhq-first-post?utm_source=share` | unknown | book: Your year is a collected edition: 12 volumes. | 18.6 | UNKNOWN | page built a book; independent read status 429 |
| 2 | www.unclosetedmedia.com | `https://www.unclosetedmedia.com/p/uncloseted-first-post?utm_source=share` | unknown | book: Your year is a collected edition: 12 volumes. | 10.1 | UNKNOWN | page built a book; independent read status 429 |
| 3 | stareyedpixels.substack.com | `HTTPS://STAREYEDPIXELS.SUBSTACK.COM/` | book 20p | book: Your archive is already a 119-page book. | 5.6 | PASS | 20 posts, 24082 words |
| 4 | dccchq.substack.com | `dccchq.substack.com` | book 9p | book: Your archive is already a 39-page book. | 5.8 | PASS | 9 posts, 5390 words |
| 5 | redbridgeintel.substack.com | `https://redbridgeintel.substack.com/p/trishwood-first-post?utm_source=share` | book 24p | book: Your archive is already a 173-page book. | 5.9 | PASS | 24 posts, 37490 words |
| 6 | www.sportsandcrime.com | `https://www.sportsandcrime.com/` | book 4p | book: Your archive is already a 32-page book. | 7.2 | PASS | 4 posts, 3975 words |
| 7 | tessa.substack.com | `tessa.substack.com` | book 1p | book: Your archive is already a 32-page book. | 5.6 | PASS | 1 posts, 2179 words |
| 8 | rlundahl.substack.com | `  https://rlundahl.substack.com  ` | book 165p+ | book: Your archive so far is a collected edition: about  | 15.5 | PASS | 165 posts, 143122 words |
| 9 | lessawkward.substack.com | `https://lessawkward.substack.com/` | book 29p | book: Your archive is already a 120-page book. | 6.9 | PASS | 29 posts, 21866 words |
| 10 | thiswillhold.substack.com | `  https://thiswillhold.substack.com  ` | book 80p | book: Your year is a collected edition: 12 volumes. | 8.0 | PASS | 80 posts, 174957 words |
| 11 | annesbalconygarden.substack.com | `annesbalconygarden.substack.com` | book 11p | book: Your archive is already a 83-page book. | 6.0 | PASS | 11 posts, 16630 words |
| 12 | dwilliamsauthor.substack.com | `dwilliamsauthor.substack.com` | book 24p | book: Your archive is already a 40-page book. | 7.0 | PASS | 24 posts, 1579 words |
| 13 | aghaonujohnbosco.substack.com | `https://aghaonujohnbosco.substack.com/archive` | book 24p | book: Your archive is already a 63-page book. | 5.9 | PASS | 24 posts, 7944 words |
| 14 | azminanews.substack.com | `  https://azminanews.substack.com  ` | book 66p | book: Your year is a collected edition: 4 volumes. | 8.4 | PASS | 66 posts, 65958 words |
| 15 | jamestynioniv.substack.com | `jamestynioniv.substack.com` | book 25p | book: Your archive is already a 139-page book. | 7.1 | PASS | 25 posts, 27962 words |

## Not covered

- Publications not in Substack's category listings (unlisted, private, or brand new)
- Paid-only archives with an export (the page cannot see them; truth here is the public list only)
- Touch hardware, screen readers, and the signup after the book (journeys A2, A4, A12 cover those on fixed hosts)
- An outage that starts mid-read: each publication is read once, at the moment it was drawn
- Non-Latin publication names in the masthead and cover (recorded, not judged)
- The stale-cache path when the base has no D1 (local runs read cold every time)
