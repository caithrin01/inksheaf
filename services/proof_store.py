"""Private, expiring host for print proofs (interior + cover PDFs).

Lulu validates files by fetching a URL, so proofs need hosting somewhere. Before this
service they were copied into the public site tree and deployed (the 2026-08-31 exposure).
Now they live on a private Modal volume and are reachable only through a URL that carries
an HMAC over (key, expiry); the URL stops working at expiry and the file is purged after a
week. The site never serves proofs.

Routes (one ASGI app, base https://caithrin--inksheaf-proof-store-web.modal.run):
  PUT  /upload?key=<k>&sig=<hmac(k:upload:bucket)>   body = the PDF bytes
  GET  /proof?key=<k>&exp=<unix>&sig=<hmac(k:exp)>   serves application/pdf (HEAD too)
Keys: proofs/<slug>/<sha12>.pdf. Secret: inksheaf-proofs (PROOF_STORE_TOKEN).
"""

import hashlib
import hmac
import os
import re
import time

import modal

app = modal.App("inksheaf-proof-store")
image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi")
volume = modal.Volume.from_name("inksheaf-proofs", create_if_missing=True)
ROOT = "/proofs"
KEY = re.compile(r"^proofs/[a-z0-9][a-z0-9-]{0,63}/[a-z]-[0-9a-f]{12}\.pdf$")
MAX_BYTES = 150_000_000  # a 44-essay print interior at 300 ppi is about 30 MB; raised from 60 MB on 2026-09-02
PURGE_AFTER = 7 * 86400


def _sig(message: str) -> str:
    token = os.environ.get("PROOF_STORE_TOKEN", "")
    return hmac.new(token.encode(), message.encode(), hashlib.sha256).hexdigest()


def _ok(sig: str, *messages: str) -> bool:
    if not os.environ.get("PROOF_STORE_TOKEN"):
        return False
    return any(hmac.compare_digest(sig, _sig(m)) for m in messages)


@app.function(image=image, secrets=[modal.Secret.from_name("inksheaf-proofs")],
              volumes={ROOT: volume}, timeout=120)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, HTTPException, Request, Response

    api = FastAPI()

    @api.put("/upload")
    async def upload(request: Request, key: str = "", sig: str = ""):
        bucket = int(time.time() // 300)
        if not _ok(sig, f"{key}:upload:{bucket}", f"{key}:upload:{bucket - 1}"):
            raise HTTPException(status_code=401, detail="unauthorized")
        if not KEY.fullmatch(key):
            raise HTTPException(status_code=400, detail="bad key")
        body = await request.body()
        if not body or len(body) > MAX_BYTES or not body.startswith(b"%PDF"):
            raise HTTPException(status_code=400, detail="not a PDF or too large")
        path = os.path.join(ROOT, key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(body)
        volume.commit()
        return {"ok": True, "key": key, "bytes": len(body),
                "sha256": hashlib.sha256(body).hexdigest()}

    def _serve(key: str, exp: str, sig: str, head: bool, range_header: str | None):
        if not exp.isdigit() or int(exp) < time.time():
            raise HTTPException(status_code=403, detail="expired")
        if not _ok(sig, f"{key}:{exp}"):
            raise HTTPException(status_code=401, detail="unauthorized")
        if not KEY.fullmatch(key):
            raise HTTPException(status_code=400, detail="bad key")
        volume.reload()
        path = os.path.join(ROOT, key)
        if not os.path.isfile(path):
            raise HTTPException(status_code=404, detail="no such proof")
        size = os.path.getsize(path)
        headers = {"content-type": "application/pdf", "accept-ranges": "bytes",
                   "cache-control": "private, no-store", "content-length": str(size)}
        if head:
            return Response(status_code=200, headers=headers)
        m = re.fullmatch(r"bytes=(\d+)-(\d*)", range_header or "")
        if m:
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
            end = min(end, size - 1)
            with open(path, "rb") as f:
                f.seek(start)
                chunk = f.read(end - start + 1)
            headers["content-range"] = f"bytes {start}-{end}/{size}"
            headers["content-length"] = str(len(chunk))
            return Response(content=chunk, status_code=206, headers=headers)
        with open(path, "rb") as f:
            data = f.read()
        return Response(content=data, status_code=200, headers=headers)

    @api.get("/proof")
    def proof(request: Request, key: str = "", exp: str = "", sig: str = ""):
        return _serve(key, exp, sig, False, request.headers.get("range"))

    @api.head("/proof")
    def proof_head(key: str = "", exp: str = "", sig: str = ""):
        return _serve(key, exp, sig, True, None)

    return api


@app.function(image=image, volumes={ROOT: volume}, schedule=modal.Period(days=1))
def purge():
    """Proofs are validation-time artifacts; nothing older than a week should exist."""
    volume.reload()
    cutoff = time.time() - PURGE_AFTER
    removed = 0
    for dirpath, _, files in os.walk(ROOT):
        for name in files:
            p = os.path.join(dirpath, name)
            if os.path.getmtime(p) < cutoff:
                os.remove(p)
                removed += 1
    if removed:
        volume.commit()
    print(f"purged {removed} proofs older than {PURGE_AFTER // 86400} days")
