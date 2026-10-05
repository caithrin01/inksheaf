// GET /api/detect?url=<address> — a fast answer to "is this a Substack?" while the writer types.
// One bounded read of the public archive's newest post. Every Substack, custom domains included,
// answers /api/v1/archive with a JSON list whose posts name their publication. No archive is read
// and nothing is stored. The full preview still makes its own complete check.
import { parseHost } from "./preview.js";
import { spend, ipKey, LIMITS } from "../lib/quota.js";

const UA = { "user-agent": "Inksheaf/1.0 (+https://inksheaf.com)", accept: "application/json" };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function detectSubstack(host, { fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  const tryHost = async h => {
    let r;
    try { r = await fetchImpl(`https://${h}/api/v1/archive?sort=new&offset=0&limit=1`, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { return { state: e?.name === "TimeoutError" ? "unknown" : "no_site" }; }
    // Substack refuses some server addresses; that says nothing about the address typed.
    if (r.status === 403 || r.status === 429 || r.status >= 500) return { state: "unknown" };
    if (!r.ok) return { state: "not_substack", status: r.status };
    let list; try { list = await r.json(); } catch { return { state: "not_substack" }; }
    if (!Array.isArray(list)) return { state: "not_substack" };
    const post = list[0], pubId = post?.publication_id;
    const name = (post?.publishedBylines || []).flatMap(b => b.publicationUsers || []).map(u => u.publication)
      .find(p => p && (pubId == null || p.id === pubId))?.name || null;
    let finalHost = h; try { finalHost = new URL(r.url).hostname || h; } catch {}
    return { state: "substack", name: name ? String(name).trim().slice(0, 120) || null : null, host: finalHost, posts: list.length ? "some" : "none" };
  };
  const first = await tryHost(host);
  // Many custom domains serve only on www.
  if (["not_substack", "no_site"].includes(first.state) && !host.startsWith("www.") && !/\.substack\.com$/.test(host) && host.split(".").length === 2) {
    const www = await tryHost("www." + host);
    if (www.state === "substack" || www.state === "unknown") return www;
  }
  return first;
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ ok: false, error: "method not allowed" }, 405);
  const raw = new URL(request.url).searchParams.get("url") || "";
  const host = parseHost(raw);
  if (!host) return json({ ok: true, state: "invalid" });
  const quota = await spend(env, await ipKey(request), LIMITS.detect_ip);
  if (!quota.ok) return json({ ok: true, state: "unknown" });
  return json({ ok: true, ...(await detectSubstack(host)) });
}
