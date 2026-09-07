#!/usr/bin/env node
import assert from 'node:assert/strict';
import { publicationFromArchive, publicationFromHomepage, publicationLogo, publicationLabel, PREVIEW_SCHEMA_VERSION } from '../functions/lib/publication-identity.js';
import { onRequest, resolvePublicationIdentity } from '../functions/api/preview.js';

// Synthetic reproduction of the reported guest-byline / wrong-publication-name failure.
const host = 'manifund.substack.com';
const fox = { id: 1491799, name: 'The Fox Says', subdomain: 'manifund',
  logo_url: 'https://substackcdn.com/image/fetch/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ffox.png' };
const other = { id: 77, name: 'Carol', subdomain: 'carol' };
const post = { id: 123, title: 'An essay', publication_id: fox.id, type: 'newsletter', audience: 'everyone',
  wordcount: 1200, post_date: new Date(Date.now() - 86400e3).toISOString(),
  publishedBylines: [{ name: 'Carol', publicationUsers: [{ publication: other }, { publication: fox }] }] };
const html = pub => `<script>window._preloads = JSON.parse(${JSON.stringify(JSON.stringify({ pub }))});</script>`;
let count = 0;
function check(name, fn) { fn(); count++; console.log(`ok ${name}`); }
check('matches publication, not first author membership', () => assert.equal(publicationFromArchive([post], host), fox));
check('looks beyond the first byline and first post', () => assert.equal(publicationFromArchive([{ publishedBylines: [{ name: 'Carol' }] }, post], host), fox));
check('never guesses a sole byline as the publication name', () => assert.equal(publicationFromArchive([{ publishedBylines: [{ name: 'Carol' }] }], host), null));
check('never returns an unrelated membership', () => assert.equal(publicationFromArchive([{ ...post, publishedBylines: [{ publicationUsers: [{ publication: other }] }] }], host), null));
check('matches explicit publication ID for a custom domain', () => assert.equal(publicationFromArchive([post], 'example.org'), fox));
check('accepts a normalized custom domain', () => assert.equal(publicationFromArchive([{ publication: { ...fox, custom_domain: 'www.example.org' } }], 'EXAMPLE.ORG')?.name, fox.name));
check('reads escaped homepage JSON without evaluating JavaScript', () => assert.equal(publicationFromHomepage(html({ ...fox, name: 'The “Fox” Says \\ Notes' }), host)?.name, 'The “Fox” Says \\ Notes'));
check('rejects homepage metadata for a different publication', () => assert.equal(publicationFromHomepage(html(other), host, [post]), null));
check('rejects malformed preload JSON', () => assert.equal(publicationFromHomepage('window._preloads = JSON.parse("oops")', host), null));
check('preserves exact publication name and removes controls', () => assert.equal(publicationLabel({ name: ' The Fox\u0000 Says ' }), 'The Fox Says'));
check('accepts Substack CDN logo', () => assert.equal(publicationLogo(fox, host), fox.logo_url));
check('accepts publication-host relative logo', () => assert.equal(publicationLogo({ logo_url: '/logo.png' }, host), `https://${host}/logo.png`));
for (const url of ['javascript:alert(1)', 'http://substackcdn.com/a.png', 'https://substackcdn.com.evil.example/a.png', 'https://user:pass@substackcdn.com/a.png', 'https://substackcdn.com:8443/a.png', '//127.0.0.1/a.png'])
  check(`rejects unsafe logo ${url}`, () => assert.equal(publicationLogo({ logo_url: url }, host), null));

const originalFetch = globalThis.fetch;
let homeResponse = () => new Response(html(fox));
let currentPosts = [post];
let calls = [];
globalThis.fetch = async (url, options) => {
  const u = new URL(url); calls.push(u.pathname);
  assert.equal(options.redirect, 'manual');
  if (u.pathname === '/') return homeResponse(options);
  assert.equal(u.pathname, '/api/v1/archive', 'tests must not use the relay or an external model');
  return new Response(JSON.stringify(u.searchParams.get('offset') === '0' ? currentPosts : []));
};
try {
  let identity = await resolvePublicationIdentity([post], host);
  check('homepage is authoritative and includes logo', () => {
    assert.equal(identity.publicationName, fox.name); assert.equal(identity.logo_url, fox.logo_url);
    assert.equal(identity.identity_source, 'publication_homepage');
  });
  homeResponse = () => new Response('unavailable', { status: 503 });
  identity = await resolvePublicationIdentity([post], host);
  check('homepage outage uses only a matched archive identity', () => {
    assert.equal(identity.publicationName, fox.name); assert.equal(identity.identity_source, 'matched_archive');
  });
  identity = await resolvePublicationIdentity([{ publishedBylines: [{ name: 'Carol' }] }], host);
  check('unresolved metadata stays unresolved', () => assert.equal(identity.publicationName, null));
  homeResponse = () => new Response(html(fox), { headers: { 'content-length': '3000000' } });
  identity = await resolvePublicationIdentity([post], host);
  check('oversized homepage is discarded', () => assert.equal(identity.identity_source, 'matched_archive'));
  homeResponse = opts => new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  const started = Date.now(); identity = await resolvePublicationIdentity([post], host);
  check('homepage timeout is bounded and preserves verified archive identity', () => {
    assert.ok(Date.now() - started < 3500); assert.equal(identity.publicationName, fox.name);
  });
  homeResponse = () => new Response(html(fox));
  let saved;
  const DB = { prepare(sql) { const stmt = { bind(...args) { stmt.args = args; return stmt; },
    async first() { return sql.startsWith('SELECT payload')
      ? { payload: JSON.stringify({ summary_version: 7, publication: 'Carol' }), fetched_at: new Date().toISOString() }
      : { n: 0 }; },
    async run() { if (sql.startsWith('INSERT INTO preview_cache')) saved = JSON.parse(stmt.args[1]); return {}; }
  }; return stmt; } };
  const request = new Request(`https://inksheaf.com/api/preview?url=${host}`);
  let response = await onRequest({ request, env: { DB } });
  let result = await response.json();
  check('v7 wrong-name cache is replaced by verified v8 name and logo', () => {
    assert.equal(response.status, 200); assert.equal(result.publication, fox.name);
    assert.equal(result.logo_url, fox.logo_url); assert.equal(result.served, 'origin');
    assert.equal(saved.summary_version, PREVIEW_SCHEMA_VERSION); assert.equal(saved.publication, fox.name);
  });
  homeResponse = () => new Response('unavailable', { status: 503 });
  currentPosts = [{ ...post, publishedBylines: [{ name: 'Carol' }] }]; saved = null;
  response = await onRequest({ request, env: { DB } }); result = await response.json();
  check('unresolved name offers a hand-built preview, never a guessed cover', () => {
    assert.equal(response.status, 422); assert.equal(result.error, 'publication_identity');
    assert.match(result.message, /hand-built/); assert.equal(saved, null);
  });
} finally { globalThis.fetch = originalFetch; }
console.log(`publication identity: ${count} checks passed`);
