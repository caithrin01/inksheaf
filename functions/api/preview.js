// GET /api/preview?url=<publication> — derived archive stats for the live book preview.
// SSRF posture (reviewed 2026-08-27): https/443 only, host gate, fixed path, no redirects,
// derived fields only, 2MB/6s caps, per-host 24h cache, global 60/min cap, no IP stored.

const MAX_POSTS = 150;
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 6000;
// Relay budget (2026-09-01): a cold read of a large archive takes 18-23s on the relay
// (measured HCR 23.0s, Slow Boring 20.7s), so the first attempt gets 28s; the whole
// retry sequence must finish inside 40s, under the client's 45s abort. Retries mainly
// clear per-IP throttling (each relay call lands on a fresh egress IP), which fails fast.
const RELAY_BUDGET_MS = 40000;
const RELAY_ATTEMPT_MS = 28000;
const RELAY_WAITS_MS = [2500, 6000];
const RELAY_MIN_ATTEMPT_MS = 4000;
const WINDOW_DAYS = 366;
import { summarizeArchive } from "../lib/preview-summary.js";
import { planEdition } from "../lib/editor.js";
import { editionWindow } from "../lib/edition-window.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET")
    return json({ ok: false, error: "method not allowed" }, 405, { allow: "GET" });
  armFault(env);

  const raw = new URL(request.url).searchParams.get("url") || "";
  const host = parseHost(raw);
  if (!host) return json({ ok: false, error: "bad_host",
    message: "That does not look like a publication URL." }, 400);

  // fresh=<hmac(host:fresh:bucket)>, signed with the relay token: the release gate reads
  // cold from origin without clearing the shared cache, so a scheduled check that hits
  // production mid-gate cannot repopulate a host under it. Unsigned callers cannot bust.
  const freshSig = new URL(request.url).searchParams.get("fresh");
  const fresh = !!freshSig && !!env.ARCHIVE_RELAY_TOKEN &&
    await freshSignatureOk(freshSig, host, env.ARCHIVE_RELAY_TOKEN);

  // Per-host cache first (also serves as the only lookup log).
  const cached = fresh ? null : await env.DB.prepare(
    "SELECT payload, fetched_at FROM preview_cache WHERE host = ?").bind(host).first()
    .catch(() => null);
  if (cached && Date.now() - Date.parse(cached.fetched_at) < 24 * 3600 * 1000) {
    const pay = JSON.parse(cached.payload);
    if (pay.summary_version === 6) return json({ ok: true, cached: true, served: "cache", ...pay });
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
  // A stale payload is a served fallback, not a fresh read: never re-stamp its fetched_at.
  if (result.data.stale) return json({ ok: true, cached: false, served: "stale", ...result.data });
  // attempts/latency_ms describe this fetch, not the archive: they never enter the cache
  const { attempts, latency_ms, ...cacheable } = result.data;
  await env.DB.prepare(
    "INSERT INTO preview_cache (host, fetched_at, payload) VALUES (?, datetime('now'), ?) " +
    "ON CONFLICT(host) DO UPDATE SET fetched_at = datetime('now'), payload = excluded.payload")
    .bind(host, JSON.stringify(cacheable)).run().catch(() => {});
  return json({ ok: true, cached: false, served: "origin", ...result.data });
}

export function parseHost(raw) {
  const handle = /(?:^|\/\/)(?:www\.)?substack\.com\/@([a-z0-9_-]{2,64})/i.exec(String(raw));
  if (handle) return handle[1].toLowerCase() + ".substack.com";
  let u;
  try { u = new URL(raw.includes("://") ? raw : "https://" + raw); } catch { return null; }
  const h = u.hostname.toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;                       // IPv4 literal
  if (h.includes(":")) return null;                                       // IPv6 literal
  if (/(^|\.)(localhost|local|internal|home|lan|corp|test|invalid)$/.test(h)) return null;
  return h;
}

export async function fetchArchive(host, env) {
  const posts = [];
  /* The summary keeps its trailing-year cutoff (the batteries compare against it); the read
     itself reaches back to the edition window's start (four completed quarters, up to 15
     months) so the editor sees every post it may bind. */
  const cutoff = Date.now() - WINDOW_DAYS * 24 * 3600 * 1000;
  const windowStart = editionWindow(Date.now()).from.getTime();
  const readBack = Math.min(cutoff, windowStart);
  const since = new Date(readBack).toISOString().slice(0, 10);
  let hops = 0;
  let relayed = false;
  let relayComplete = true;
  let relayMeta = null;
  /* the 40s budget runs from the first byte of work, not from the first relay call: the
     direct timeout (6s) and any www hop count, so the answer lands before the page's 45s abort */
  const t0 = Date.now();
  for (let offset = 0; offset < MAX_POSTS; ) {
    let page;
    {
      const direct = await fetchDirectArchive(host, offset);
      if (direct.redirect) {
        const nextHost = parseHost(direct.redirect.startsWith("http")
          ? direct.redirect : `https://${host}${direct.redirect}`);
        if (nextHost && nextHost !== host && hops < 2) { hops++; host = nextHost; continue; }
        /* self-redirects and path rewrites dead-end here; some Substack custom domains
           (generalist.com) loop on the apex while www serves the archive, so spend one
           hop on www before giving up */
        if (!host.startsWith("www.") && hops < 2) { hops++; host = "www." + host; continue; }
        /* a same-host path redirect on the archive API means this is not Substack
           (Substack never rewrites its own API path; Ghost and WordPress do) */
        return { ok: false, error: "not_substack", status: 422,
          message: "Could not find a Substack archive there. Check the address?" };
      }
      if (direct.ok) page = direct.page;
      else if (direct.retryable) {
        /* a thrown direct read (no status) on a host that does not resolve is a typo:
           answer in a second rather than after a 30s relay sweep */
        if (direct.threw && !(await hostExists(host)))
          return { ok: false, error: "not_substack", status: 422,
            message: "Could not find a Substack archive there. Check the address?" };
        /* one batch call: the relay fetches and paces every page server-side */
        /* each relay request lands on a fresh container (max_inputs=1), so each retry
           is a new egress IP against Substack's per-IP scoring */
        let via, attempts = 0;
        for (;;) {
          const remaining = RELAY_BUDGET_MS - (Date.now() - t0);
          if (remaining < RELAY_MIN_ATTEMPT_MS) break;
          via = await fetchRelayedAll(host, env, Math.min(RELAY_ATTEMPT_MS, remaining), since);
          attempts++;
          if (via.ok) break;
          const wait = RELAY_WAITS_MS[attempts - 1];
          if (wait === undefined || Date.now() - t0 + wait + RELAY_MIN_ATTEMPT_MS > RELAY_BUDGET_MS) break;
          await new Promise(r => setTimeout(r, wait));
        }
        relayMeta = { attempts, latency_ms: Date.now() - t0 };
        if (!via || !via.ok){
          via = via || { ok: false, error: "relay budget exhausted" };
          const stale = await env.DB.prepare(
            "SELECT payload FROM preview_cache WHERE host = ?").bind(host).first().catch(() => null);
          if (stale){
            const pay = JSON.parse(stale.payload);
            if (pay.summary_version === 6) return { ok: true, data: { ...pay, stale: true, ...relayMeta } };
          }
          /* The direct read failed on a retryable status (429, 5xx, timeout, DNS) and the
             relay failed too. The relay's error text cannot tell a dead domain from an
             outage ("upstream unavailable" covers both), so ask a resolver: only a host
             that does not exist is the writer's typo; everything else is an outage or a
             block and gets the retry plus hand-built offer. Incident 2026-09-01:
             understandingai.org was unreachable for 31s and the page blamed the URL. */
          if (!(await hostExists(host)))
            return { ok: false, error: "not_substack", status: 422, ...relayMeta,
              message: "Could not find a Substack archive there. Check the address?" };
          return { ...archiveUnavailable(via.error), ...relayMeta };
        }
        relayed = true;
        relayComplete = via.complete;
        posts.length = 0;
        posts.push(...via.posts);
        break;
      } else {
        /* many Substack custom domains serve only on www; an apex 404 deserves one www try */
        if (direct.status === 404 && !host.startsWith("www.") && hops < 2) {
          hops++; host = "www." + host; continue;
        }
        return { ok: false, error: "not_substack", status: 422, upstream: direct.status,
          message: "Could not read an archive there. Is this a Substack publication URL?" };
      }
    }
    if (!page.length) break;
    posts.push(...page);
    offset += page.length;
    if (page.length && Date.parse(page[page.length - 1].post_date || 0) < readBack) break;
    /* The direct read has a 150-post budget. A daily publication spends it inside the quarter
       in progress and never reaches the window (HCR: 109 posts, 8 in the window, 2026-09-01).
       When the budget runs out before the window start, the relay reads the rest. */
    if (offset >= MAX_POSTS && Date.parse(page[page.length - 1].post_date || 0) >= readBack && env.ARCHIVE_RELAY_TOKEN) {
      /* two tries: Substack answers 429 to the relay's first big read now and then
         (michaelpopok, 2026-09-02) and the second lands on a fresh egress IP */
      let via = null, attempts = 0;
      for (;;) {
        const remaining = RELAY_BUDGET_MS - (Date.now() - t0);
        if (remaining < RELAY_MIN_ATTEMPT_MS || attempts >= 2) break;
        via = await fetchRelayedAll(host, env, Math.min(RELAY_ATTEMPT_MS, remaining), since);
        attempts++;
        if (via.ok) break;
        if (Date.now() - t0 + RELAY_WAITS_MS[0] + RELAY_MIN_ATTEMPT_MS > RELAY_BUDGET_MS) break;
        await new Promise(r => setTimeout(r, RELAY_WAITS_MS[0]));
      }
      relayMeta = { attempts, latency_ms: Date.now() - t0 };
      if (via && via.ok && via.posts.length > posts.length) {
        relayed = true; relayComplete = via.complete;
        posts.length = 0; posts.push(...via.posts);
      }
      break;
    }
  }

  const identityPost = posts.find(p => p && p.post_date && Date.parse(p.post_date) >= cutoff
    && (p.type === "newsletter" || !p.type));
  if (!identityPost)
    return { ok: false, error: "empty", status: 200,
      message: "The public archive there looks empty for the last year. Paid-only archives preview after you join the beta." };
  const capped = relayed ? !relayComplete : posts.length >= MAX_POSTS;
  const identity = identityFromArchive(identityPost, host);
  const data = summarizeArchive(posts, identity, host, cutoff, capped);
  if (!data) return { ok: false, error: "empty", status: 200,
    message: "There are no public essays to preview from the last year. Join the beta and send a Substack export for paid work." };
  data.fetch_mode = relayed ? "relay" : "direct";
  // The plan the page paints at once is the calendar's (milliseconds). The editor's plan takes
  // 15 to 100 s of model time, so it is a second request (/api/plan) that the page asks for
  // after the reveal and swaps in; `pending` says one is worth asking for.
  const tEd = Date.now();
  const editorial = await planEdition({ posts, identity, host, capped });
  data.editorial = { ...editorial, editor_ms: Date.now() - tEd, pending: !!(env.OPENROUTER_API_KEY || env.ANTHROPIC_API_KEY) };
  data.summary_version = 6;
  if (relayMeta) Object.assign(data, relayMeta);
  return { ok: true, data, posts, identity };
}

/* Fault injection for the journeys (plan-end-to-end-v1, phase 5): the local server is started
   with FAULT_SWITCH=1 and FAULT=<name>; production never carries FAULT_SWITCH, so this is inert
   there. Names: direct_fail (every direct read answers 503), relay_fail (relay answers 503),
   relay_slow (relay answers after 20 s), editor_fail (the editor throws). */
let FAULT = null;
export function armFault(env) { FAULT = env && env.FAULT_SWITCH === "1" ? (env.FAULT || null) : null; return FAULT; }
async function fetchDirectArchive(host, offset) {
  if (FAULT === "direct_fail") return { ok: false, status: 503, retryable: true };
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
  } catch { clearTimeout(timer); return { ok: false, retryable: true, status: 502, threw: true }; }
}

async function fetchRelayedAll(host, env, timeoutMs, since) {
  if (!env.ARCHIVE_RELAY_TOKEN) return { ok: false, error: "relay secret unavailable" };
  if (FAULT === "relay_fail") return { ok: false, error: "upstream unavailable (injected)" };
  if (FAULT === "relay_slow") await new Promise(r => setTimeout(r, Math.min(20000, timeoutMs - 500)));
  const bucket = Math.floor(Date.now() / 300000);
  const signature = await hmacHex(env.ARCHIVE_RELAY_TOKEN, `${host}:all:${bucket}`);
  const relayUrl = "https://caithrin--inksheaf-archive-relay-archive.modal.run" +
    `?host=${encodeURIComponent(host)}&mode=all&sig=${signature}` + (since ? `&since=${since}` : "");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(relayUrl, { redirect: "manual", signal: ctl.signal,
      headers: { accept: "text/plain", "user-agent": "inksheaf-preview/2.0 (+https://inksheaf.com)" } });
    clearTimeout(timer);
    if (!r.ok){
      const detail = await r.text().then(t => { try { return JSON.parse(t).detail || t; } catch { return t; } }).catch(() => "");
      return { ok: false, error: `relay ${r.status} ${String(detail).slice(0, 60)}` };
    }
    const complete = r.headers.get("x-archive-complete") !== "0";
    const value = JSON.parse(await readLimitedText(r, MAX_BYTES * 4));
    return Array.isArray(value) ? { ok: true, posts: value, complete } : { ok: false, error: "invalid relay shape" };
  } catch (e) { clearTimeout(timer); return { ok: false, error: String(e?.message || e) }; }
}

async function freshSignatureOk(sig, host, secret) {
  const bucket = Math.floor(Date.now() / 300000);
  for (const b of [bucket, bucket - 1])
    if (sig === await hmacHex(secret, `${host}:fresh:${b}`)) return true;
  return false;
}

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* DNS-over-HTTPS lookup, only on the failure path. Anything but a definite NXDOMAIN
   (resolver down, timeout, odd status) counts as existing: doubt goes to the writer. */
async function hostExists(host) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2000);
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
      { headers: { accept: "application/dns-json" }, signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) return true;
    const d = await r.json();
    return d.Status !== 3;
  } catch { clearTimeout(timer); return true; }
}

function archiveUnavailable(detail) {
  return { ok: false, error: "upstream_busy", status: 503,
    message: "That archive did not answer just now. Try again in a minute, or send it below and we will build the preview by hand.",
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

async function readLimitedText(resp, cap = MAX_BYTES) {
  const declared = Number(resp.headers.get("content-length") || 0);
  if (declared > cap) throw new Error("response too large");
  if (!resp.body?.getReader) throw new Error("streaming body unavailable");
  const reader = resp.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) { await reader.cancel(); throw new Error("response too large"); }
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
