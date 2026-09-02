// POST /api/links — the press registers the short links a built edition prints. Signed with the
// relay token: sig = hmac(secret, `links:${signup_id}`). Rows: { code, target, kind, slug, letter }.
// Upsert by code; a code always maps to the same normalised target, so re-registration is idempotent.
import { hmacHex } from "../lib/press-dispatch.js";
import { normalizeUrl } from "../lib/links.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  if (Number(request.headers.get("content-length") || 0) > 512_000) return json({ ok: false, error: "too large" }, 413);
  let body; try { body = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
  const id = Number(body.signup_id);
  if (!id || !env.ARCHIVE_RELAY_TOKEN || String(body.sig || "") !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `links:${id}`)) return json({ ok: false, error: "bad signature" }, 403);
  const rows = Array.isArray(body.links) ? body.links.slice(0, 5000) : [];
  let n = 0;
  const stmt = env.DB.prepare(`INSERT INTO links (code, target, kind, signup_id, slug, letter) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET target = excluded.target, signup_id = excluded.signup_id, slug = excluded.slug, letter = excluded.letter`);
  const batch = [];
  for (const r of rows) {
    const code = String(r.code || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12); const target = normalizeUrl(r.target);
    if (!code || !target) continue;
    batch.push(stmt.bind(code, target, String(r.kind || "link").slice(0, 12), id, String(r.slug || "").slice(0, 200), String(r.letter || "").slice(0, 4))); n++;
    if (batch.length === 100) { await env.DB.batch(batch.splice(0)); }
  }
  if (batch.length) await env.DB.batch(batch);
  return json({ ok: true, registered: n });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
