// GET /api/preview?url=<publication> — derived archive stats for the live book preview.
// SSRF posture (reviewed 2026-08-27): https/443 only, host gate, fixed path, no redirects,
// derived fields only, 2MB/6s caps, per-host 24h cache, global 60/min cap, no IP stored.

const MAX_POSTS = 150;
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 6000;
const WINDOW_DAYS = 366;

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
  if (cached && Date.now() - Date.parse(cached.fetched_at) < 24 * 3600 * 1000)
    return json({ ok: true, cached: true, ...JSON.parse(cached.payload) });

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

  const result = await fetchArchive(host);
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

async function fetchArchive(host) {
  const posts = [];
  const cutoff = Date.now() - WINDOW_DAYS * 24 * 3600 * 1000;
  let hops = 0;
  for (let offset = 0; offset < MAX_POSTS; ) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let resp;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        resp = await fetch(`https://${host}/api/v1/archive?sort=new&offset=${offset}&limit=25`, {
          redirect: "manual", signal: ctl.signal,
          headers: { accept: "application/json", "user-agent": "inksheaf-preview/1.0 (+https://inksheaf.pages.dev)" },
        });
      } catch {
        clearTimeout(timer);
        return { ok: false, error: "unreachable", status: 502,
          message: "Could not reach that publication. The signup below works without a preview." };
      }
      if ((resp.status === 429 || resp.status >= 500) && attempt === 0) {
        await new Promise(r => setTimeout(r, 1200));
        continue;
      }
      break;
    }
    clearTimeout(timer);
    if (resp.status === 429)
      return { ok: false, error: "upstream_busy", status: 503, upstream: 429,
        message: "Substack is rate-limiting our reader for that publication right now. Try again in a minute, or sign up below and we will send your preview by email." };
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location") || "";
      const nextHost = parseHost(loc.startsWith("http") ? loc : `https://${host}${loc}`);
      if (nextHost && nextHost !== host && hops < 2) { hops++; host = nextHost; continue; }
      return { ok: false, error: "redirect", status: 502,
        message: "That address redirects somewhere we could not follow. Try the publication's final URL." };
    }
    if (!resp.ok)
      return { ok: false, error: "not_substack", status: 502, upstream: resp.status,
        message: "Could not read an archive there. Is this a Substack publication URL?" };
    const text = (await resp.text()).slice(0, MAX_BYTES);
    let page;
    try { page = JSON.parse(text); } catch {
      return { ok: false, error: "not_substack", status: 502,
        message: "That page did not answer like a Substack archive. Is this the publication's URL?" };
    }
    if (!Array.isArray(page))
      return { ok: false, error: "not_substack", status: 502,
        message: "That page did not answer like a Substack archive. Is this the publication's URL?" };
    if (!page.length) break;
    posts.push(...page);
    offset += page.length;
    if (page.length && Date.parse(page[page.length - 1].post_date || 0) < cutoff) break;
  }

  const recent = posts.filter(p => p && p.post_date && Date.parse(p.post_date) >= cutoff
    && (p.type === "newsletter" || p.type === "podcast" || !p.type));
  if (!recent.length)
    return { ok: false, error: "empty", status: 200,
      message: "The public archive there looks empty for the last year. Paid-only archives preview after you join the beta." };

  const words = recent.reduce((s, p) => s + (Number(p.wordcount) || 0), 0);
  const dates = recent.map(p => Date.parse(p.post_date)).sort((a, b) => a - b);
  const pages = Math.max(30, Math.round(words / 350 + recent.length * 0.8 + 8));
  const capped = posts.length >= MAX_POSTS;
  return { ok: true, data: {
    host,
    publication: (recent[0].publishedBylines?.[0]?.name) || host.split(".")[0],
    posts: recent.length, capped, words,
    est_pages: pages,
    from: new Date(dates[0]).toISOString().slice(0, 10),
    to: new Date(dates[dates.length - 1]).toISOString().slice(0, 10),
    titles: recent.slice(0, 5).map(p => String(p.title || "").slice(0, 90)),
  } };
}

function pubName(recent, host) {
  const names = {};
  for (const p of recent) for (const b of (p.publishedBylines || []))
    if (b?.name) names[b.name] = (names[b.name] || 0) + 1;
  const distinct = Object.keys(names);
  if (distinct.length === 1) return distinct[0];
  const label = host.replace(/^www\./, "").split(".")[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
