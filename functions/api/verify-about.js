// The verification fallback by publication (Codex audit P0-8, Caithrin's design): when the
// Substack address does not forward, the writer puts a code on the publication's About page.
//   POST /api/verify-about {signup_id}         -> {code} to paste (also stored as a pending row)
//   POST /api/verify-about {signup_id, check}  -> reads https://<host>/about; if the code is there,
//      the reservation is verified and the press starts.
import { dispatchPress } from "../lib/press-dispatch.js";
import { spend, LIMITS } from "../lib/quota.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  let b; try { b = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
  const id = Number(b.signup_id); if (!id) return json({ ok: false, error: "signup_id" }, 400);
  const s = await env.DB.prepare("SELECT id, publication_url, email, plan_json, dispatch_status FROM signups WHERE id = ?").bind(id).first().catch(() => null);
  if (!s) return json({ ok: false, error: "not found" }, 404);
  const host = s.publication_url.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  const q = await spend(env, `about:${host}`, LIMITS.verify_host); if (!q.ok) return json({ ok: false, error: "too many checks for this publication this hour" }, 429);
  const pending = await env.DB.prepare("SELECT token FROM email_verifications WHERE signup_id = ? AND email = 'about-page' AND verified_at IS NULL AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1").bind(id).first().catch(() => null);
  let token = pending?.token;
  if (!token) {
    token = "inksheaf-verify-" + [...crypto.getRandomValues(new Uint8Array(4))].map(x => "abcdefghjkmnpqrstuvwxyz23456789"[x % 31]).join("");
    await env.DB.prepare("INSERT INTO email_verifications (token, email, signup_id, expires_at) VALUES (?, 'about-page', ?, datetime('now', '+2 days'))").bind(token, id).run();
  }
  if (!b.check) return json({ ok: true, code: token, where: `https://${host}/about`, instructions: `Add the line ${token} anywhere on the publication's About page and save, then press Check. Remove it afterwards.` });
  /* the check: the About page, and the newest posts as a second place the code could be */
  let found = false;
  for (const url of [`https://${host}/about`, `https://${host}/api/v1/archive?sort=new&limit=3`]) {
    try { const t = await (await fetch(url, { headers: { "user-agent": "inksheaf-verify/1.0" } })).text(); if (t.includes(token)) { found = true; break; } } catch {}
  }
  if (!found) return json({ ok: true, verified: false, code: token, message: "Not there yet. Pages can take a minute to update after saving; try Check again." });
  await env.DB.prepare("UPDATE email_verifications SET verified_at = datetime('now') WHERE token = ?").bind(token).run();
  await env.DB.prepare("UPDATE signups SET email_verified_at = datetime('now') WHERE id = ?").bind(id).run().catch(() => {});
  if (s.dispatch_status === "dispatched") return json({ ok: true, verified: true, press: "dispatched" });
  const d = await dispatchPress(env, { event: "press", signup_id: s.id, publication_url: s.publication_url, email: s.email, plan_json: s.plan_json });
  await env.DB.prepare("UPDATE signups SET dispatch_status = ? WHERE id = ?").bind(d.ok ? "dispatched" : "queued", s.id).run().catch(() => {});
  await env.DB.prepare(`INSERT INTO press (signup_id, status, detail, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(signup_id) DO UPDATE SET status = excluded.status, detail = excluded.detail, updated_at = datetime('now')`)
    .bind(s.id, d.ok ? "building" : "queued", JSON.stringify({ message: d.ok ? "press started after About-page verification" : "dispatch failed: " + (d.reason || d.status) })).run().catch(() => {});
  return json({ ok: true, verified: true, press: d.ok ? "dispatched" : "queued" });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
