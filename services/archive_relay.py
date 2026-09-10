"""Authenticated origin for Substack archive metadata and bounded public samples.

Cloudflare egress is rate-limited by Substack, so the Pages Function uses this only after its
direct request fails. The relay exposes one fixed read-only path, validates the response as a JSON
array. The separate sample endpoint reads one signed, identified public post;
archive responses still omit bodies.
"""

import hmac
import hashlib
import ipaddress
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

import modal

app = modal.App("inksheaf-archive-relay")
# A finished read outlives the caller: the Pages Function aborts an attempt at 28s and
# retries, and without this the retry started over. Results are keyed by host for 10 min.
results = modal.Dict.from_name("inksheaf-relay-results", create_if_missing=True)
RESULT_TTL = 600
RESULT_SCHEMA = 2  # include the publication's original logo in slim identity metadata
PAGE_BATCH = 4          # concurrent archive pages per batch (GCP egress; measured clean)
BATCH_PAUSE = 0.25
image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi")
MAX_BYTES = 2_000_000
HOST = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$")


def valid_host(host: str) -> bool:
    host = host.lower().strip().rstrip(".")
    if not HOST.fullmatch(host) or ":" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not re.search(r"(^|\.)(localhost|local|internal|home|lan|corp|test|invalid)$", host)


# max_inputs recycles the container every few requests, rotating the egress IP;
# Substack scores per-IP reputation and a long-lived relay IP accumulates 403s.
# cloud="gcp": Substack's Cloudflare edge serves a managed challenge (403, cf-mitigated:
# challenge) to Azure egress at the first page, and Modal otherwise places containers on
# either cloud. Measured 2026-09-01: mixed placement 13/20 cold reads succeeded; pinned to
# GCP 5/5 containers read every page. Retries on the same container never clear a challenge.
@app.function(image=image, secrets=[modal.Secret.from_name("inksheaf-relay")], timeout=60,
              max_inputs=1, cloud="gcp")
@modal.fastapi_endpoint(method="GET")
def archive(host: str, offset: int = 0, sig: str = "", mode: str = "page", cold: int = 0, since: str = ""):
    from fastapi import HTTPException, Response

    expected = os.environ.get("ARCHIVE_RELAY_TOKEN", "")
    import time as _t
    bucket = int(_t.time() // 300)
    if mode == "all":
        candidates = [f"{host}:all:{b}" for b in (bucket, bucket - 1)]
    else:
        candidates = [f"{host}:{offset}"]
    ok_sig = any(hmac.compare_digest(sig,
        hmac.new(expected.encode(), m.encode(), hashlib.sha256).hexdigest()) for m in candidates)
    if not expected or not ok_sig:
        raise HTTPException(status_code=401, detail="unauthorized")
    host = host.lower().strip().rstrip(".")
    if not valid_host(host) or offset < 0 or offset > 150 or offset % 25:
        raise HTTPException(status_code=400, detail="bad request")

    if mode == "all":
        hit = None
        result_key = f"v{RESULT_SCHEMA}|{host}|{since}"
        if not cold:   # cold=1 (signed callers only) forces a fresh read, for the reliability sample
            try:
                hit = results.get(result_key)
            except Exception:
                hit = None
        if hit and _t.time() - hit["at"] < RESULT_TTL:
            return Response(content=hit["body"], media_type="application/json",
                            headers={"Cache-Control": "private, max-age=300",
                                     "X-Archive-Complete": "1" if hit["complete"] else "0",
                                     "X-Relay-Result": "reused"})
        # fetch the trailing year by date, not by post count; up to 28 pages, four at a time
        cutoff = (_t.time() - 366 * 86400) * 1000
        # since=YYYY-MM-DD (2026-09-01): the edition window is four completed quarters, up to
        # 15 months back, so the Pages Function may ask for more than the trailing year.
        if since:
            try:
                import datetime as _dt
                since_ms = _dt.datetime.strptime(since, "%Y-%m-%d").replace(tzinfo=_dt.timezone.utc).timestamp() * 1000
                cutoff = min(cutoff, since_ms)
            except ValueError:
                pass
        # a daily letter needs about 1,100 posts to cover fifteen months (HCR: 723 posts reached
        # only 2025-11-05 at the old 700 cap, 2026-09-01)
        combined, complete = read_archive(lambda off: fetch_page(host, off, HTTPException), cutoff, max_offset=1800 if since else 700)
        combined = [slim(p) for p in combined]
        body = json.dumps(combined).encode()
        # a fifteen-month daily letter is about 1,500 slim rows; the 2 MB page cap does not
        # apply to the combined read (michaelpopok answered "response too large", 2026-09-02)
        if len(body) > MAX_BYTES * 4:
            raise HTTPException(status_code=502, detail="response too large")
        try:
            results[result_key] = {"at": _t.time(), "body": body, "complete": complete}
        except Exception:
            pass
        return Response(content=body, media_type="application/json",
                        headers={"Cache-Control": "private, max-age=300",
                                 "X-Archive-Complete": "1" if complete else "0",
                                 "X-Relay-Result": "read"})

    body = json.dumps(fetch_page(host, offset, HTTPException)).encode()
    return Response(content=body, media_type="application/json",
                    headers={"Cache-Control": "private, max-age=300"})


def _post_ms(page):
    from datetime import datetime
    oldest = page[-1].get("post_date") or ""
    try:
        return datetime.fromisoformat(oldest.replace("Z", "+00:00")).timestamp() * 1000
    except (ValueError, AttributeError):
        return None


def read_archive(fetch, cutoff_ms, batch_size=PAGE_BATCH, pause=BATCH_PAUSE, max_offset=700):
    """Read archive pages back to cutoff_ms. Returns (posts, complete).

    Substack's offset counts posts, and a page can come back shorter than the limit asked
    for: since at least 2026-09-01 the first page answers 23 for limit=25 on every
    publication measured, while offset=23 continues cleanly. Reading fixed offsets
    0, 25, 50 skipped two real posts per archive (random battery, 14 of 30 hosts, all +2).
    So the first page is read alone and every later batch starts at the count read so far;
    a short page inside a batch discards the pages after it and resyncs from its end.
    """
    import time as _t
    from concurrent.futures import ThreadPoolExecutor
    combined, next_off, done = [], 0, False

    def take(off, page):
        nonlocal next_off, done
        if not page:
            done = True
            return False
        combined.extend(page)
        next_off = off + len(page)
        oldest_ms = _post_ms(page)
        if oldest_ms is not None and oldest_ms < cutoff_ms:
            done = True
            return False
        return len(page) >= 25

    take(0, fetch(0))
    with ThreadPoolExecutor(max_workers=batch_size) as pool:
        while not done and next_off < max_offset:
            _t.sleep(pause)
            batch = [next_off + 25 * i for i in range(batch_size)]
            pages = list(pool.map(fetch, batch))
            for off, page in zip(batch, pages):
                if not take(off, page):
                    break
    return combined, done or next_off < max_offset


def slim(p):
    """Strip a post to the fields the preview summarizer and identity code consume."""
    def pub_slim(u):
        pub = (u.get("publication") or {}) if isinstance(u, dict) else {}
        return {"publication": {k: pub.get(k) for k in
                ("name", "custom_domain", "subdomain", "id", "theme_var_background_pop", "logo_url")}}
    body = str(p.get("body_html") or "")
    import re as _re
    return {
        "id": p.get("id"),
        "slug": str(p.get("slug") or "")[:200],
        "subtitle": str(p.get("subtitle") or "")[:120],
        "truncated_body_text": str(p.get("truncated_body_text") or "")[:160],
        # counts the editor reads; the body itself never leaves the relay (size)
        "footnotes": len(_re.findall(r'class="footnote-anchor"', body)),
        "links": len(_re.findall(r'<a\b[^>]*href="https?:', body)),
        "images": len(_re.findall(r'<img\b', body, _re.I)),
        "title": str(p.get("title") or "")[:200],
        "wordcount": p.get("wordcount"),
        "post_date": p.get("post_date"),
        "audience": p.get("audience"),
        "type": p.get("type"),
        "section_name": p.get("section_name"),
        "cover_image": (str(p.get("cover_image"))[:200] if p.get("cover_image") else None),
        "postTags": [{"name": (t.get("name") if isinstance(t, dict) else t)}
                     for t in (p.get("postTags") or [])[:8]],
        "publication_id": p.get("publication_id"),
        "publishedBylines": [
            {"name": b.get("name"),
             "publicationUsers": [pub_slim(u) for u in (b.get("publicationUsers") or [])[:3]]}
            for b in (p.get("publishedBylines") or [])[:3] if isinstance(b, dict)],
    }


def fetch_page(host, offset, HTTPException):
    source = f"https://{host}/api/v1/archive?sort=new&offset={offset}&limit=25"
    req = urllib.request.Request(source, headers={
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 inksheaf-archive-relay/1.0 (+https://inksheaf.com)",
        "Referer": f"https://{host}/archive",
    })
    import time
    body = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as upstream:
                final = urllib.parse.urlparse(upstream.url)
                if final.scheme != "https" or not valid_host(final.hostname or ""):
                    raise HTTPException(status_code=502, detail="unsafe redirect")
                body = upstream.read(MAX_BYTES + 1)
            break
        except urllib.error.HTTPError as exc:
            # Substack throttles datacenter egress with sporadic 403/429; backoff clears it
            if exc.code in (403, 429) and attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise HTTPException(status_code=503 if exc.code == 429 or exc.code >= 500 else 502,
                                detail=f"upstream {exc.code}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt < 2:
                time.sleep(1.0)
                continue
            raise HTTPException(status_code=503, detail="upstream unavailable") from exc

    if len(body) > MAX_BYTES:
        raise HTTPException(status_code=502, detail="response too large")
    try:
        value = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="invalid upstream JSON") from exc
    if not isinstance(value, list):
        raise HTTPException(status_code=502, detail="invalid archive shape")
    return value


def sample_signature_ok(secret, host, slug, post_id, signature, now=None):
    import time
    if (not secret or not valid_host(host) or
            not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,199}", slug, re.I) or
            not isinstance(post_id, int) or not 0 < post_id <= 9007199254740991):
        return False
    bucket = int((time.time() if now is None else now) // 300)
    return any(hmac.compare_digest(signature, hmac.new(secret.encode(),
        f"{host}:sample:{slug}:{post_id}:{b}".encode(), hashlib.sha256).hexdigest())
        for b in (bucket, bucket - 1))


def fetch_public_sample(host, slug, post_id, HTTPException):
    # Follow only the same publication's www alias, on the exact public-post path.
    # Never forward authentication or let an upstream redirect choose another origin.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    path = f"/api/v1/posts/{slug}"
    target = f"https://{host}{path}"
    body = None
    for _ in range(3):
        request = urllib.request.Request(target, headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 Inksheaf-public-sample/1.0 (+https://inksheaf.com)",
            "Referer": f"https://{host}/p/{slug}",
        })
        try:
            with opener.open(request, timeout=5) as upstream:
                body = upstream.read(MAX_BYTES + 1)
            break
        except urllib.error.HTTPError as exc:
            if not 300 <= exc.code < 400:
                raise HTTPException(status_code=502, detail="public post unavailable") from exc
            next_url = urllib.parse.urljoin(target, exc.headers.get("Location", ""))
            parsed = urllib.parse.urlparse(next_url)
            if (parsed.scheme != "https" or parsed.username or parsed.password or
                    parsed.port or (parsed.hostname or "").removeprefix("www.") != host.removeprefix("www.") or
                    parsed.path != path or parsed.query or parsed.fragment):
                raise HTTPException(status_code=502, detail="unsafe redirect") from exc
            target = next_url
        except (urllib.error.URLError, TimeoutError) as exc:
            raise HTTPException(status_code=503, detail="public post unavailable") from exc
    if body is None or len(body) > MAX_BYTES:
        raise HTTPException(status_code=502, detail="public post response limit")
    try:
        post = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=502, detail="invalid public post") from exc
    if (not isinstance(post, dict) or str(post.get("id")) != str(post_id) or
            post.get("slug") != slug or post.get("audience") != "everyone" or
            post.get("is_published") is False or not isinstance(post.get("body_html"), str) or
            not post["body_html"].strip()):
        raise HTTPException(status_code=422, detail="public post unavailable")
    return {k: post.get(k) for k in ("id", "slug", "title", "subtitle", "post_date",
                                    "audience", "is_published", "body_html")}


@app.function(image=image, secrets=[modal.Secret.from_name("inksheaf-relay")], timeout=20,
              max_inputs=1, cloud="gcp")
@modal.fastapi_endpoint(method="GET")
def sample(host: str, slug: str, post_id: int, sig: str = ""):
    from fastapi import HTTPException, Response
    if not sample_signature_ok(os.environ.get("ARCHIVE_RELAY_TOKEN", ""), host, slug, post_id, sig):
        raise HTTPException(status_code=401, detail="unauthorized")
    post = fetch_public_sample(host, slug, post_id, HTTPException)
    return Response(content=json.dumps(post).encode(), media_type="application/json",
                    headers={"Cache-Control": "no-store"})
