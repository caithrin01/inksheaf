// POST /api/list-queue {sig: hmac("list-queue")} -> the editions waiting to be listed on Lulu.
// The private worker (scripts/lulu-worker.mjs), signed in as the Inksheaf Lulu account, calls this,
// lists each one, and reports back through /api/listed. The public site holds NO Lulu credentials;
// only the worker does. Auth is the shared relay token, same as the press endpoints.
import { hmacHex } from "../lib/press-dispatch.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  let b; try { b = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
  if (!env.ARCHIVE_RELAY_TOKEN || String(b.sig || "") !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, "list-queue"))
    return json({ ok: false, error: "bad signature" }, 403);
  const limit = Math.min(Math.max(Number(b.limit) || 10, 1), 50);
  // ready to list = the version reached listing-pending and has no listing URL yet
  const rows = await env.DB.prepare(
    `SELECT v.id AS version_id, v.signup_id, v.volumes, v.pages, v.print_mode, v.quote_json, s.publication_url, s.email
       FROM edition_versions v JOIN signups s ON s.id = v.signup_id
      WHERE v.status = 'listing-pending' AND (v.listing_url IS NULL OR v.listing_url = '')
      ORDER BY v.updated_at ASC LIMIT ?`).bind(limit).all().catch(() => ({ results: [] }));
  const queue = (rows.results || []).map(r => {
    let volumes = []; try { volumes = JSON.parse(r.volumes || "[]"); } catch {}
    let quote = null; try { quote = JSON.parse(r.quote_json || "null"); } catch {}
    const host = String(r.publication_url || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    // the worker needs the built files' proof keys, pages, and labels per volume
    const built = volumes.map(v => ({ label: v.label, pages: v.pages, pubName: v.pubName || host,
      interiorKey: v.key || v.interiorKey, coverKey: v.coverKey, sha256: v.sha256 }));
    return { signup_id: r.signup_id, version_id: r.version_id, host, print_mode: r.print_mode, quote, built };
  }).filter(e => e.built.length && e.built[0].interiorKey && e.built[0].coverKey);
  return json({ ok: true, count: queue.length, queue });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
