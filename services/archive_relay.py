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


@app.function(image=image, secrets=[modal.Secret.from_name("inksheaf-relay")], timeout=60)
@modal.fastapi_endpoint(method="GET")
def archive(host: str, offset: int = 0, sig: str = "", mode: str = "page"):
    from fastapi import HTTPException, Response

    expected = os.environ.get("ARCHIVE_RELAY_TOKEN", "")
    message = f"{host}:all" if mode == "all" else f"{host}:{offset}"
    expected_sig = hmac.new(expected.encode(), message.encode(), hashlib.sha256).hexdigest()
    if not expected or not hmac.compare_digest(sig, expected_sig):
        raise HTTPException(status_code=401, detail="unauthorized")
    host = host.lower().strip().rstrip(".")
    if not valid_host(host) or offset < 0 or offset > 150 or offset % 25:
        raise HTTPException(status_code=400, detail="bad request")

    if mode == "all":
        combined = []
        for off in range(0, 150, 25):
            page = fetch_page(host, off, HTTPException)
            if not page:
                break
            combined.extend(page)
            import time
            time.sleep(0.7)
        body = json.dumps(combined).encode()
        if len(body) > MAX_BYTES:
            raise HTTPException(status_code=502, detail="response too large")
        return Response(content=body, media_type="application/json",
                        headers={"Cache-Control": "private, max-age=300"})

    body = json.dumps(fetch_page(host, offset, HTTPException)).encode()
    return Response(content=body, media_type="application/json",
                    headers={"Cache-Control": "private, max-age=300"})


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
