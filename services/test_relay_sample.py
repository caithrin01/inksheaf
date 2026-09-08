"""Public-sample authentication, identity and redirect checks; no Modal or network."""
import hashlib
import hmac
import io
import json
import sys
import time
import types
import unittest
import urllib.error
from unittest.mock import patch

modal = types.ModuleType("modal")
class App:
    def __init__(self, *a, **k): pass
    def function(self, *a, **k): return lambda f: f
class Image:
    @staticmethod
    def debian_slim(*a, **k): return Image()
    def pip_install(self, *a, **k): return self
modal.App, modal.Image = App, Image
modal.Dict = types.SimpleNamespace(from_name=lambda *a, **k: {})
modal.Secret = types.SimpleNamespace(from_name=lambda *a, **k: None)
modal.fastapi_endpoint = lambda *a, **k: lambda f: f
sys.modules['modal'] = modal
import archive_relay as relay

class HTTPException(Exception):
    def __init__(self, status_code, detail): self.status_code, self.detail = status_code, detail
class Response:
    def __init__(self, **kwargs): self.__dict__.update(kwargs)
fastapi = types.SimpleNamespace(HTTPException=HTTPException, Response=Response)
SECRET, HOST, SLUG, PID = 'local-sample-secret', 'example.substack.com', 'a-real-essay', 12
POST = dict(id=PID, slug=SLUG, audience='everyone', is_published=True,
            body_html='<p>Public prose.</p>', title='An essay', private_metadata='omit this')
def sign(host=HOST, slug=SLUG, pid=PID, bucket=None):
    bucket = int(time.time() // 300) if bucket is None else bucket
    return hmac.new(SECRET.encode(), f'{host}:sample:{slug}:{pid}:{bucket}'.encode(), hashlib.sha256).hexdigest()
class Opener:
    def __init__(self, responses): self.responses, self.calls = list(responses), []
    def open(self, req, timeout):
        self.calls.append(req.full_url)
        reply = self.responses.pop(0)
        if isinstance(reply, Exception): raise reply
        return io.BytesIO(reply if isinstance(reply, bytes) else json.dumps(reply).encode())

class SampleTests(unittest.TestCase):
    def fetch(self, responses):
        self.opener = Opener(responses)
        with patch('urllib.request.build_opener', return_value=self.opener):
            return relay.fetch_public_sample(HOST, SLUG, PID, HTTPException)
    def test_signature_is_scoped_and_expires(self):
        now = 3000000
        for b in (10000, 9999):
            self.assertTrue(relay.sample_signature_ok(SECRET, HOST, SLUG, PID, sign(bucket=b), now))
        for sig in (sign(bucket=9998), sign(bucket=10001), sign(slug='another', bucket=10000),
                    sign(pid=13, bucket=10000), sign(host='other.substack.com', bucket=10000),
                    hmac.new(SECRET.encode(), f'{HOST}:all:10000'.encode(), hashlib.sha256).hexdigest()):
            self.assertFalse(relay.sample_signature_ok(SECRET, HOST, SLUG, PID, sig, now))
    def test_invalid_inputs_do_not_authorize(self):
        for host, slug, pid in [('127.0.0.1', SLUG, PID), ('host.local', SLUG, PID),
                                (HOST, '../secret', PID), (HOST, SLUG, 0), (HOST, SLUG, 2**54)]:
            self.assertFalse(relay.sample_signature_ok(SECRET, host, slug, pid, sign(host, slug, pid)))
        self.assertFalse(relay.sample_signature_ok('', HOST, SLUG, PID, sign()))
    def test_returns_only_identified_public_post_fields(self):
        p = self.fetch([POST]); self.assertEqual(p['body_html'], POST['body_html'])
        self.assertNotIn('private_metadata', p)
    def test_refuses_paid_unpublished_wrong_or_empty_post(self):
        for edit in [dict(id=99), dict(slug='different'), dict(audience='only_paid'),
                     dict(is_published=False), dict(body_html=''), dict(body_html=None)]:
            with self.subTest(edit=edit), self.assertRaises(HTTPException) as e:
                self.fetch([{**POST, **edit}])
            self.assertEqual(e.exception.status_code, 422)
    def test_response_limit_and_json_shape(self):
        for body in (b'x' * (relay.MAX_BYTES + 1), b'not JSON', b'[]'):
            with self.assertRaises(HTTPException): self.fetch([body])
    def test_www_alias_redirect_only(self):
        for target in ['https://127.0.0.1/secret', 'https://other.substack.com/api/v1/posts/'+SLUG,
                       'http://'+HOST+'/api/v1/posts/'+SLUG, 'https://'+HOST+'/api/v1/posts/other',
                       'https://'+HOST+'/api/v1/posts/'+SLUG+'?token=x']:
            error = urllib.error.HTTPError('https://'+HOST, 302, 'redirect', {'Location':target}, None)
            with self.assertRaises(HTTPException): self.fetch([error, POST])
            self.assertEqual(len(self.opener.calls), 1)
        target = 'https://www.'+HOST+'/api/v1/posts/'+SLUG
        error = urllib.error.HTTPError('https://'+HOST, 301, 'redirect', {'Location':target}, None)
        self.assertEqual(self.fetch([error, POST])['id'], PID)
        self.assertEqual(self.opener.calls[-1], target)
    def test_endpoint_authenticates_before_reading(self):
        with patch.dict(sys.modules, {'fastapi':fastapi}), patch.dict(relay.os.environ, {'ARCHIVE_RELAY_TOKEN':SECRET}), patch.object(relay, 'fetch_public_sample', return_value=POST) as read:
            with self.assertRaises(HTTPException): relay.sample(HOST, SLUG, PID, '')
            read.assert_not_called()
            self.assertEqual(json.loads(relay.sample(HOST, SLUG, PID, sign()).content)['id'], PID)
            read.assert_called_once()

if __name__ == '__main__': unittest.main()
