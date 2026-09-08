// A small identity read for live covers. No archive crawl, editor, signup or funnel event.
import { parseHost, resolvePublicationIdentity, identityFromPublication, readLimitedText } from './preview.js';
import { PREVIEW_SCHEMA_VERSION, publicationFromArchive, publicationLogo } from '../lib/publication-identity.js';
import { spend, ipKey } from '../lib/quota.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': status === 200 ? 'public, max-age=3600' : 'no-store' }
});
const payload = (host, identity) => ({ ok: true, host, publication: identity.publicationName,
  logo_url: identity.logo_url, theme: identity.theme });

export async function onRequest({ request, env, waitUntil }) {
  if (request.method !== 'GET') return json({ ok: false }, 405);
  const host = parseHost(new URL(request.url).searchParams.get('url') || '');
  if (!host) return json({ ok: false }, 400);
  const cache = globalThis.caches?.default;
  const key = new Request(`${new URL(request.url).origin}/api/publication?url=${encodeURIComponent(host)}`);
  const hit = await cache?.match(key);
  if (hit) return hit;
  const quotas = await Promise.all([ipKey(request).then(k => spend(env, `identity:${k}`, 120)), spend(env, `identity:${host}`, 60)]);
  if (quotas.some(q => !q.ok)) return json({ ok: false }, 429);
  const finish = body => {
    const response = json(body);
    if (cache) { const saving = cache.put(key, response.clone()).catch(() => {}); if (waitUntil) waitUntil(saving); }
    return response;
  };
  // A full preview can supply this smaller response, but missing logos deserve a fresh read.
  try {
    const row = await env.DB.prepare('SELECT payload, fetched_at FROM preview_cache WHERE host = ?').bind(host).first();
    const p = row && JSON.parse(row.payload);
    if (p?.summary_version === PREVIEW_SCHEMA_VERSION && p.publication && p.logo_url &&
        Date.now() - Date.parse(row.fetched_at) < 86400000) {
      const logo = publicationLogo(p, host);
      if (logo) return finish({ ok: true, host, publication: p.publication, logo_url: logo, theme: p.theme });
    }
  } catch { /* A missing cache never prevents a public identity read. */ }
  const home = await resolvePublicationIdentity([], host);
  if (home.publicationName && home.logo_url) return finish(payload(host, home));
  // Existing relay page mode retains original publication metadata. Read one page only.
  const posts = await firstPage(host, env);
  const pub = publicationFromArchive(posts, host);
  const identity = home.publicationName ? home : identityFromPublication(pub, host);
  if (home.publicationName && !home.logo_url && pub && String(pub.id) === String(home.publication_id))
    identity.logo_url = publicationLogo(pub, host);
  if (!identity.publicationName) return json({ ok: false }, 422);
  return finish(payload(host, identity));
}

async function firstPage(host, env) {
  let url = `https://${host}/api/v1/archive?sort=new&offset=0&limit=10`;
  if (env.ARCHIVE_RELAY_TOKEN) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.ARCHIVE_RELAY_TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${host}:0`)))].map(b => b.toString(16).padStart(2, '0')).join('');
    url = `https://caithrin--inksheaf-archive-relay-archive.modal.run?host=${encodeURIComponent(host)}&offset=0&sig=${signature}`;
  }
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(6000),
      headers: { accept: 'application/json', 'user-agent': 'inksheaf-preview/1.0 (+https://inksheaf.com)' } });
    if (!r.ok) return [];
    const value = JSON.parse(await readLimitedText(r));
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
