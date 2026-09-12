"""Exercise actual private checkpoint route functions without Modal or network."""
import asyncio
import hashlib
import os
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

class App:
    def __init__(self, *a, **k): pass
    def function(self, *a, **k): return lambda f: f
class Image:
    @staticmethod
    def debian_slim(*a, **k): return Image()
    def pip_install(self, *a, **k): return self
volume = types.SimpleNamespace(commit=lambda: None, reload=lambda: None)
sys.modules['modal'] = types.SimpleNamespace(App=App, Image=Image, Volume=types.SimpleNamespace(from_name=lambda *a, **k: volume), Secret=types.SimpleNamespace(from_name=lambda *a, **k: None), asgi_app=lambda: lambda f: f, Period=lambda **k: None)
class HTTPException(Exception):
    def __init__(self, status_code, detail): self.status_code, self.detail = status_code, detail
class Response:
    def __init__(self, **k): self.__dict__.update(k)
class API:
    def __init__(self): self.routes = {}
    def route(self, method, path):
        def add(f): self.routes[method, path] = f; return f
        return add
    def put(self, path): return self.route('PUT', path)
    def get(self, path): return self.route('GET', path)
    def head(self, path): return self.route('HEAD', path)
class Request:
    def __init__(self, body): self.body = body
    async def stream(self):
        for n in range(0, len(self.body), 7): yield self.body[n:n+7]
sys.modules['fastapi'] = types.SimpleNamespace(FastAPI=API, HTTPException=HTTPException, Response=Response, Request=Request)
import proof_store as store

class Checkpoints(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'PROOF_STORE_TOKEN': 'private-test'}); self.env.start()
        self.root = patch.object(store, 'ROOT', self.dir.name); self.root.start()
        api = store.web(); self.put = api.routes['PUT', '/checkpoint']; self.get = api.routes['GET', '/checkpoint']
        self.data = b'private completed render bundle'; self.sha = hashlib.sha256(self.data).hexdigest()
        self.key = f'checkpoints/signup-15/{self.sha}.json.gz'
    def tearDown(self): self.root.stop(); self.env.stop(); self.dir.cleanup()
    def upload(self, key=None, data=None, purpose='checkpoint-upload'):
        key = key or self.key
        return asyncio.run(self.put(Request(self.data if data is None else data), key, store._sig(f'{key}:{purpose}:{int(time.time()//300)}')))
    def read(self, key=None, exp=None, purpose='checkpoint-read'):
        key = key or self.key; exp = str(int(time.time())+60 if exp is None else exp)
        return self.get(key, exp, store._sig(f'{key}:{purpose}:{exp}'))
    def test_private_exact_bytes_and_hash(self):
        self.assertEqual(self.upload()['sha256'], self.sha)
        response = self.read(); self.assertEqual(response.content, self.data); self.assertEqual(response.headers['cache-control'], 'private, no-store')
    def test_wrong_purpose_cannot_upload_or_read(self):
        for action in [lambda: self.upload(purpose='upload'), lambda: self.read(purpose='proof'), lambda: asyncio.run(self.put(Request(self.data), self.key, 'wrong'))]:
            with self.assertRaises(HTTPException) as error: action()
            self.assertEqual(error.exception.status_code, 401)
    def test_tamper_traversal_expiry_and_missing_hold(self):
        for action, status in [(lambda: self.upload(data=b'changed'), 400), (lambda: self.upload(key='checkpoints/../../bad.json.gz'), 400), (lambda: self.read(exp=1), 403), (lambda: self.read(), 404)]:
            with self.assertRaises(HTTPException) as error: action()
            self.assertEqual(error.exception.status_code, status)
        self.assertFalse(any(files for _, _, files in os.walk(self.dir.name)))
    def test_streaming_size_limit_leaves_no_partial_file(self):
        with patch.object(store, 'MAX_BYTES', 8):
            with self.assertRaises(HTTPException) as error: self.upload()
        self.assertEqual(error.exception.status_code, 413)
        self.assertFalse(any(files for _, _, files in os.walk(self.dir.name)))
    def test_retention_purges_old_checkpoint(self):
        self.upload(); path = os.path.join(self.dir.name, self.key)
        old = time.time()-store.PURGE_AFTER-1; os.utime(path, (old, old)); store.purge()
        self.assertFalse(os.path.exists(path))

if __name__ == '__main__': unittest.main()
