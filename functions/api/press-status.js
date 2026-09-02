// POST /api/press-status — the press (GitHub Actions) reports a reservation's progress.
// Signed with the relay token: sig = hmac(secret, `${signup_id}:${status}`). One row per signup.
import { hmacHex } from "../lib/press-dispatch.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  let body; try { body = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
  const id = Number(body.signup_id), status = String(body.status || "").slice(0, 40);
  if (!id || !status) return json({ ok: false, error: "signup_id and status required" }, 400);
  if (!env.ARCHIVE_RELAY_TOKEN || String(body.sig || "") !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `${id}:${status}`))
    return json({ ok: false, error: "bad signature" }, 403);
  const detail = JSON.stringify({ proof_key: body.proof_key || null, proof_url: body.proof_url || null, listing_url: body.listing_url || null,
    message: String(body.message || "").slice(0, 500), run: body.run || null,
    files: Array.isArray(body.files) ? body.files.slice(0, 24) : undefined, jobs: Array.isArray(body.jobs) ? body.jobs.slice(0, 60) : undefined }).slice(0, 16000);
  await env.DB.prepare(`INSERT INTO press (signup_id, status, detail, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(signup_id) DO UPDATE SET status = excluded.status, detail = excluded.detail, updated_at = datetime('now')`)
    .bind(id, status, detail).run();
  return json({ ok: true });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
