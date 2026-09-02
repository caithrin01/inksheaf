// GET  /api/change?id&sig  -> the reservation's plan, for the change page
// POST /api/change {id, sig, request} -> records what the writer wants changed, tells the operator
// Signed like the approval link (hmac "change:<id>"). The writer's words are stored as data.
import { hmacHex, dispatchPress } from "../lib/press-dispatch.js";

export async function onRequest({ request, env }) {
  const u = new URL(request.url);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const id = Number(u.searchParams.get("id") || body.id), sig = String(u.searchParams.get("sig") || body.sig || "");
  if (!id || !env.ARCHIVE_RELAY_TOKEN || sig !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `change:${id}`))
    return json({ ok: false, error: "bad link" }, 403);
  const row = await env.DB.prepare("SELECT id, publication_url, email, plan_json, created_at FROM signups WHERE id = ?").bind(id).first().catch(() => null);
  if (!row) return json({ ok: false, error: "not found" }, 404);
  if (request.method === "GET") {
    let plan = null; try { plan = JSON.parse(row.plan_json || "null"); } catch {}
    const press = await env.DB.prepare("SELECT status, updated_at FROM press WHERE signup_id = ?").bind(id).first().catch(() => null);
    return json({ ok: true, id, publication_url: row.publication_url, plan, status: press?.status || "reserved" });
  }
  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  const text = String(body.request || "").trim().slice(0, 4000);
  if (!text) return json({ ok: false, error: "say what should change" }, 400);
  await env.DB.prepare(`INSERT INTO press (signup_id, status, detail, updated_at) VALUES (?, 'change-requested', ?, datetime('now'))
    ON CONFLICT(signup_id) DO UPDATE SET status = 'change-requested', detail = excluded.detail, updated_at = datetime('now')`)
    .bind(id, JSON.stringify({ request: text })).run();
  await dispatchPress(env, { event: "change", signup_id: id, publication_url: row.publication_url, email: row.email, request: text });
  return json({ ok: true });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
