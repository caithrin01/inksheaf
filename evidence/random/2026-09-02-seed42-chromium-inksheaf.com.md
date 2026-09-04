# Random-publication battery, 2026-09-02, seed 42

Engine chromium, base https://inksheaf.com, 3 publications drawn from Substack's public category listings (0 on custom domains).
Result: PASS: 3 pass, 0 degraded, 0 fail, 0 unknown; p95 11.6s, slowest 11.6s.
Repeat with `node scripts/test-random-substacks.mjs chromium https://inksheaf.com --n=3 --seed=42`.

| # | host | pasted as | independent read | page outcome | s | verdict | note |
|---|---|---|---|---|---|---|---|
| 1 | paulinelaigneau.substack.com | `HTTPS://PAULINELAIGNEAU.SUBSTACK.COM/` | book 6p+ | book: Your year is one book. | 6.1 | PASS | 6 posts, 3518 words · planned by the calendar · our editor is reading your archive |
| 2 | recipesbyrallyrus.substack.com | `https://recipesbyrallyrus.substack.com/p/neaarentzen-first-post?utm_source=share` | book 24p | book: Your year is one book. | 10.8 | PASS | 24 posts, 21989 words · planned by the calendar · our editor is reading your archive |
| 3 | charlotteenfrance.substack.com | `  https://charlotteenfrance.substack.com  ` | book 1p | book: Your year is one book. | 11.6 | PASS | 1 posts, 618 words · planned by the calendar · our editor is reading your archive |

## Not covered

- Publications not in Substack's category listings (unlisted, private, or brand new)
- Paid-only archives with an export (the page cannot see them; truth here is the public list only)
- Touch hardware, screen readers, and the signup after the book (journeys A2, A4, A12 cover those on fixed hosts)
- An outage that starts mid-read: each publication is read once, at the moment it was drawn
- Non-Latin publication names in the masthead and cover (recorded, not judged)
- The stale-cache path when the base has no D1 (local runs read cold every time)
