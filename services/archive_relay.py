"""Minimal authenticated origin for Substack archive metadata.

Cloudflare egress is rate-limited by Substack, so the Pages Function uses this only after its
direct request fails. The relay exposes one fixed read-only path, validates the response as a JSON
array, and never requests post bodies.
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
def archive(host: str, offset: int = 0, sig: str = "", mode: str = "page", cold: int = 0):
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
        if not cold:   # cold=1 (signed callers only) forces a fresh read, for the reliability sample
            try:
                hit = results.get(host)
            except Exception:
                hit = None
        if hit and _t.time() - hit["at"] < RESULT_TTL:
            return Response(content=hit["body"], media_type="application/json",
                            headers={"Cache-Control": "private, max-age=300",
                                     "X-Archive-Complete": "1" if hit["complete"] else "0",
                                     "X-Relay-Result": "reused"})
        # fetch the trailing year by date, not by post count; up to 28 pages, four at a time
        cutoff = (_t.time() - 366 * 86400) * 1000
        combined, complete = [], True
        from concurrent.futures import ThreadPoolExecutor
        from datetime import datetime
        offsets = list(range(0, 700, 25))
        done = False
        with ThreadPoolExecutor(max_workers=PAGE_BATCH) as pool:
            for b in range(0, len(offsets), PAGE_BATCH):
                batch = offsets[b:b + PAGE_BATCH]
                pages = list(pool.map(lambda off: fetch_page(host, off, HTTPException), batch))
                for off, page in zip(batch, pages):
                    if not page:
                        done = True
                        break
                    combined.extend(slim(p) for p in page)
                    oldest = page[-1].get("post_date") or ""
                    try:
                        oldest_ms = datetime.fromisoformat(oldest.replace("Z", "+00:00")).timestamp() * 1000
                        if oldest_ms < cutoff:
                            done = True
                            break
                    except (ValueError, AttributeError):
                        pass
                if done:
                    break
                if batch[-1] >= 675:
                    complete = False
                    break
                _t.sleep(BATCH_PAUSE)
        body = json.dumps(combined).encode()
        if len(body) > MAX_BYTES:
            raise HTTPException(status_code=502, detail="response too large")
        try:
            results[host] = {"at": _t.time(), "body": body, "complete": complete}
        except Exception:
            pass
        return Response(content=body, media_type="application/json",
                        headers={"Cache-Control": "private, max-age=300",
                                 "X-Archive-Complete": "1" if complete else "0",
                                 "X-Relay-Result": "read"})

    body = json.dumps(fetch_page(host, offset, HTTPException)).encode()
    return Response(content=body, media_type="application/json",
                    headers={"Cache-Control": "private, max-age=300"})


def slim(p):
    """Strip a post to the fields the preview summarizer and identity code consume."""
    def pub_slim(u):
        pub = (u.get("publication") or {}) if isinstance(u, dict) else {}
        return {"publication": {k: pub.get(k) for k in
                ("name", "custom_domain", "subdomain", "id", "theme_var_background_pop")}}
    return {
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
