"""Regression test for the relay's archive paging (random battery, 2026-09-01).

Substack's first archive page answers 23 posts for limit=25 (every host measured on
2026-09-01), and offset counts posts, so reading fixed offsets 0, 25, 50 skips raw posts
23 and 24: two real, public posts vanished from every relay-served preview (14 of 30
random hosts, all +2 against an independent read). The relay must page by the count read
so far. Runs without Modal: the module's Modal objects are stubbed before import.

    python3 services/test_relay_paging.py
"""
import sys
import types
from datetime import datetime, timedelta, timezone

# archive_relay builds Modal objects at import; give it inert stand-ins
_modal = types.ModuleType("modal")


class _App:
    def __init__(self, *a, **k): pass
    def function(self, *a, **k): return lambda f: f


class _Image:
    @staticmethod
    def debian_slim(*a, **k): return _Image()
    def pip_install(self, *a, **k): return self


class _Dict:
    @staticmethod
    def from_name(*a, **k): return {}


_modal.App = _App
_modal.Image = _Image
_modal.Dict = _Dict
_modal.Secret = types.SimpleNamespace(from_name=lambda *a, **k: None)
_modal.fastapi_endpoint = lambda *a, **k: (lambda f: f)
sys.modules["modal"] = _modal

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from archive_relay import read_archive, slim  # noqa: E402

NOW = datetime(2026, 9, 1, 12, tzinfo=timezone.utc)
CUTOFF_MS = (NOW - timedelta(days=366)).timestamp() * 1000


def make_raw(n, days_apart=7):
    return [{"id": i, "title": f"post {i}",
             "post_date": (NOW - timedelta(days=i * days_apart)).isoformat().replace("+00:00", "Z")}
            for i in range(n)]


class FakeSubstack:
    """offset counts posts; the first page (offset 0) answers 23 for limit=25, like the real
    API since 2026-09-01; extra short pages can be planted at other offsets."""

    def __init__(self, raw, short={0: 23}):
        self.raw, self.short, self.calls = raw, short, []

    def __call__(self, off):
        self.calls.append(off)
        n = self.short.get(off, 25)
        return self.raw[off:off + n]


def fixed_offsets(fetch):
    """the reading the relay did before the fix: offsets 0, 25, 50, ... regardless of page size"""
    out = []
    for off in range(0, 700, 25):
        page = fetch(off)
        if not page:
            break
        out.extend(page)
    return out


passed = failed = 0


def check(name, cond, extra=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"ok   {name}")
    else:
        failed += 1
        print(f"FAIL {name}  {extra}")


# 1. the old reading loses two posts; the new one loses none
raw = make_raw(60)
old = fixed_offsets(FakeSubstack(raw))
check("old fixed-offset reading skipped posts 23 and 24", [p["id"] for p in raw if p not in old] == [23, 24],
      str([p["id"] for p in raw if p not in old]))
fake = FakeSubstack(raw)
posts, complete = read_archive(fake, CUTOFF_MS, pause=0)
ids = [p["id"] for p in posts]
check("new reading: every post in the window, in order, no gaps", ids == list(range(len(ids))) and len(ids) >= 53,
      f"got {len(ids)} ids, first gap at {next((i for i, v in enumerate(ids) if v != i), None)}")
check("new reading: no duplicates", len(ids) == len(set(ids)))
check("new reading: read to the cutoff and stopped", complete and max(ids) >= 52 and len(ids) <= 60, f"complete={complete} n={len(ids)}")
check("first page read alone, then batches from the count read", fake.calls[:5] == [0, 23, 48, 73, 98], str(fake.calls[:6]))

# 2. a short page in the middle of a batch: the pages after it are discarded and reread
raw = make_raw(200, days_apart=1)
fake = FakeSubstack(raw, short={0: 23, 48: 20})
posts, complete = read_archive(fake, CUTOFF_MS, pause=0)
ids = [p["id"] for p in posts]
check("mid-batch short page: still every post, no gaps", ids == list(range(200)), f"n={len(ids)} gap at "
      f"{next((i for i, v in enumerate(ids) if v != i), None)}")
check("mid-batch short page: resynced from its end", 68 in fake.calls and 73 in fake.calls and fake.calls.index(68) > fake.calls.index(73), str(fake.calls[:12]))
check("mid-batch short page: read to the end, complete", complete)

# 3. an archive deeper than the year: stops at the cutoff, reports complete
raw = make_raw(400, days_apart=3)
fake = FakeSubstack(raw)
posts, complete = read_archive(fake, CUTOFF_MS, pause=0)
in_window = [p for p in raw if datetime.fromisoformat(p["post_date"].replace("Z", "+00:00")).timestamp() * 1000 >= CUTOFF_MS]
check("deep archive: every post inside the window is present", all(p in posts for p in in_window), f"{len(posts)} read, {len(in_window)} in window")
check("deep archive: complete", complete)
check("deep archive: stopped within a batch of the cutoff", len(posts) < len(in_window) + 4 * 25 + 25, f"{len(posts)} read")

# 4. a year with more than 700 posts: capped and marked incomplete
raw = make_raw(900, days_apart=0)
raw = [dict(p, post_date=NOW.isoformat().replace("+00:00", "Z")) for p in raw]
fake = FakeSubstack(raw)
posts, complete = read_archive(fake, CUTOFF_MS, pause=0)
check("more than 700 posts in the year: marked incomplete", not complete and len(posts) >= 700, f"complete={complete} n={len(posts)}")
check("capped read: still no gaps", [p["id"] for p in posts] == list(range(len(posts))))

# 5. an empty archive
posts, complete = read_archive(FakeSubstack([]), CUTOFF_MS, pause=0)
check("empty archive: nothing read, complete", posts == [] and complete)


# slim keeps what the editor reads (2026-09-01): the id, slug, excerpt and counts; never the body
_p = slim({"id": 42, "slug": "hello", "title": "T", "wordcount": "900", "post_date": "2026-01-02T00:00:00Z",
           "audience": "everyone", "type": "newsletter", "subtitle": "S", "truncated_body_text": "x" * 500,
           "body_html": '<img src=a><a class="footnote-anchor" href="#f1">1</a><a class="footnote-anchor" href="#f2">2</a><a href="https://x">l</a><a href="#local">n</a>'})
check("slim keeps the id", _p.get("id") == 42)
check("slim keeps the slug", _p.get("slug") == "hello")
check("slim counts footnotes", _p.get("footnotes") == 2)
check("slim counts external links only", _p.get("links") == 1)
check("slim counts images", _p.get("images") == 1)
check("slim drops the body", "body_html" not in _p)
check("slim trims the excerpt", len(_p.get("truncated_body_text", "")) == 240)

print(f"\n{passed} pass, {failed} fail")
sys.exit(1 if failed else 0)
