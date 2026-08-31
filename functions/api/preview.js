// GET /api/preview?url=<publication> — derived archive stats for the live book preview.
// SSRF posture (reviewed 2026-08-27): https/443 only, host gate, fixed path, no redirects,
// derived fields only, 2MB/6s caps, per-host 24h cache, global 60/min cap, no IP stored.

const MAX_POSTS = 150;
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 6000;
const RELAY_TIMEOUT_MS = 30000;
const WINDOW_DAYS = 366;
import { summarizeArchive } from "../lib/preview-summary.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET")
    return json({ ok: false, error: "method not allowed" }, 405, { allow: "GET" });

  const raw = new URL(request.url).searchParams.get("url") || "";
  const host = parseHost(raw);
  if (!host) return json({ ok: false, error: "bad_host",
    message: "That does not look like a publication URL." }, 400);

  // Per-host cache first (also serves as the only lookup log).
  const cached = await env.DB.prepare(
    "SELECT payload, fetched_at FROM preview_cache WHERE host = ?").bind(host).first()
    .catch(() => null);
  if (cached && Date.now() - Date.parse(cached.fetched_at) < 24 * 3600 * 1000) {
    const pay = JSON.parse(cached.payload);
    if (pay.summary_version === 3) return json({ ok: true, cached: true, ...pay });
  }

  // Global rate cap, no IP involved.
  const minute = new Date().toISOString().slice(0, 16);
  const rl = await env.DB.prepare(
    "SELECT count(*) n FROM events WHERE event = 'preview_fetch' AND created_at > datetime('now','-60 seconds')")
    .first().catch(() => ({ n: 0 }));
  if ((rl?.n || 0) >= 60)
    return json({ ok: false, error: "busy",
      message: "Previews are busy right now. The signup below works without one." }, 429);
  await env.DB.prepare("INSERT INTO events (session, event) VALUES (?, 'preview_fetch')")
    .bind(minute).run().catch(() => {});

  const result = await fetchArchive(host, env);
  if (!result.ok) {
    await env.DB.prepare("INSERT INTO events (session, event) VALUES ('', 'preview_fail')").run().catch(() => {});
    return json(result, result.status || 502);
  }

  await env.DB.prepare("INSERT INTO events (session, event) VALUES ('', 'preview_ok')").run().catch(() => {});
  await env.DB.prepare(
    "INSERT INTO preview_cache (host, fetched_at, payload) VALUES (?, datetime('now'), ?) " +
    "ON CONFLICT(host) DO UPDATE SET fetched_at = datetime('now'), payload = excluded.payload")
    .bind(host, JSON.stringify(result.data)).run().catch(() => {});
  return json({ ok: true, cached: false, ...result.data });
}

function parseHost(raw) {
  let u;
  try { u = new URL(raw.includes("://") ? raw : "https://" + raw); } catch { return null; }
  const h = u.hostname.toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;                       // IPv4 literal
  if (h.includes(":")) return null;                                       // IPv6 literal
  if (/(^|\.)(localhost|local|internal|home|lan|corp|test|invalid)$/.test(h)) return null;
  return h;
}

async function fetchArchive(host, env) {
  const posts = [];
  const cutoff = Date.now() - WINDOW_DAYS * 24 * 3600 * 1000;
  let hops = 0;
  let relayed = false;
  for (let offset = 0; offset < MAX_POSTS; ) {
    let page;
    {
      const direct = await fetchDirectArchive(host, offset);
      if (direct.redirect) {
        const nextHost = parseHost(direct.redirect.startsWith("http")
          ? direct.redirect : `https://${host}${direct.redirect}`);
        if (nextHost && nextHost !== host && hops < 2) { hops++; host = nextHost; continue; }
        return { ok: false, error: "redirect", status: 502,
          message: "That address redirects somewhere we could not follow. Try the publication's final URL." };
      }
      if (direct.ok) page = direct.page;
      else if (direct.retryable) {
        /* one batch call: the relay fetches and paces every page server-side */
        const via = await fetchRelayedAll(host, env);
        if (!via.ok) return archiveUnavailable(via.error);
        relayed = true;
        posts.length = 0;
        posts.push(...via.posts);
        break;
      } else return { ok: false, error: "not_substack", status: 502, upstream: direct.status,
        message: "Could not read an archive there. Is this a Substack publication URL?" };
    }
    if (!page.length) break;
    posts.push(...page);
    offset += page.length;
    if (page.length && Date.parse(page[page.length - 1].post_date || 0) < cutoff) break;
  }

  const identityPost = posts.find(p => p && p.post_date && Date.parse(p.post_date) >= cutoff
    && (p.type === "newsletter" || !p.type));
  if (!identityPost)
    return { ok: false, error: "empty", status: 200,
      message: "The public archive there looks empty for the last year. Paid-only archives preview after you join the beta." };
  const capped = posts.length >= MAX_POSTS;
  const identity = identityFromArchive(identityPost, host);
  const data = summarizeArchive(posts, identity, host, cutoff, capped);
  if (!data) return { ok: false, error: "empty", status: 200,
    message: "There are no public essays to preview from the last year. Join the beta and send a Substack export for paid work." };
  data.fetch_mode = relayed ? "relay" : "direct";
  return { ok: true, data };
}

async function fetchDirectArchive(host, offset) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`https://${host}/api/v1/archive?sort=new&offset=${offset}&limit=25`, {
      redirect: "manual", signal: ctl.signal,
      headers: { accept: "application/json", "user-agent": "inksheaf-preview/1.0 (+https://inksheaf.pages.dev)" },
    });
    clearTimeout(timer);
    if (r.status >= 300 && r.status < 400) return { ok: false, redirect: r.headers.get("location") || "" };
    if (!r.ok) return { ok: false, status: r.status, retryable: r.status === 429 || r.status >= 500 };
    const value = JSON.parse(await readLimitedText(r));
    return Array.isArray(value) ? { ok: true, page: value } : { ok: false, status: 502 };
  } catch { clearTimeout(timer); return { ok: false, retryable: true, status: 502 }; }
}

async function fetchRelayedAll(host, env) {
  if (!env.ARCHIVE_RELAY_TOKEN) return { ok: false, error: "relay secret unavailable" };
  const signature = await hmacHex(env.ARCHIVE_RELAY_TOKEN, `${host}:all`);
  const relayUrl = "https://caithrin--inksheaf-archive-relay-archive.modal.run" +
    `?host=${encodeURIComponent(host)}&mode=all&sig=${signature}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), RELAY_TIMEOUT_MS);
  try {
    const r = await fetch(relayUrl, { redirect: "manual", signal: ctl.signal,
      headers: { accept: "text/plain", "user-agent": "inksheaf-preview/2.0 (+https://inksheaf.com)" } });
    clearTimeout(timer);
    if (!r.ok) return { ok: false, error: `relay ${r.status}` };
    const value = JSON.parse(await readLimitedText(r));
    return Array.isArray(value) ? { ok: true, posts: value } : { ok: false, error: "invalid relay shape" };
  } catch (e) { clearTimeout(timer); return { ok: false, error: String(e?.message || e) }; }
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

function archiveUnavailable(detail) {
  return { ok: false, error: "upstream_busy", status: 503,
    message: "We could not read that archive automatically. Send it below and we will build the preview by hand.",
    detail: String(detail || "unavailable").slice(0, 120) };
}

function identityFromArchive(post, host) {
  const pub = publicationFromPost(post, host);
  const publicationName = pub?.name ? String(pub.name).slice(0, 120) : null;
  const bg = parseColor(pub?.theme_var_background_pop);
  if (!bg) return { publicationName, theme: null };
  const light = [255, 255, 255], dark = [34, 29, 22];
  const ink = contrast(bg, light) >= contrast(bg, dark) ? light : dark;
  if (contrast(bg, ink) < 4.5) return { publicationName, theme: null };
  return { publicationName, theme: { cover_bg: hex(bg), cover_ink: hex(ink),
    cover_ink2: lum(bg) < 0.45 ? "#d9d9d9" : "#5a554b", accent: hex(bg), heading_stack: null } };
}

function publicationFromPost(post, host) {
  const pubs = [];
  for (const byline of (post?.publishedBylines || []))
    for (const user of (byline?.publicationUsers || []))
      if (user?.publication?.name) pubs.push(user.publication);
  const normalized = host.replace(/^www\./, "");
  return pubs.find(p => String(p.custom_domain || "").replace(/^www\./, "") === normalized)
    || pubs.find(p => `${p.subdomain}.substack.com` === normalized)
    || pubs.find(p => p.id === post?.publication_id)
    || pubs[0];
}

async function readLimitedText(resp) {
  const declared = Number(resp.headers.get("content-length") || 0);
  if (declared > MAX_BYTES) throw new Error("response too large");
  if (!resp.body?.getReader) throw new Error("streaming body unavailable");
  const reader = resp.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error("response too large"); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(all);
}
function parseColor(c) {
  if (!c || typeof c !== "string") return null;
  const m = c.trim().match(/^#([0-9a-f]{6})$/i);
  if (m) { const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  const rgb = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return rgb ? [+rgb[1], +rgb[2], +rgb[3]] : null;
}
const lum = ([r, g, b]) => {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => { const [x, y] = [lum(a) + 0.05, lum(b) + 0.05]; return x > y ? x / y : y / x; };
const hex = rgb => "#" + rgb.map(v => v.toString(16).padStart(2, "0")).join("");

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
