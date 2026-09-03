// Publication verification (Codex audit P0-8, Caithrin's design 2026-09-02):
//   POST /api/verify {signup_id}  -> sends a one-time link to <subdomain>@substack.com, the
//     address the publication sends from (Substack forwards it to the owner); answers which
//     address it went to. The subdomain comes from the archive's byline data, never from a title.
//   GET  /api/verify?t=<token>    -> marks the reservation verified and starts the press.
// Fallbacks (proof by About-page code, DNS record, or a person) record the same row with their
// method; the press runs only when a verification row exists for the reservation.
import { hmacHex, dispatchPress } from "../lib/press-dispatch.js";
import { spend, LIMITS } from "../lib/quota.js";
import { prepareOutboundEmail } from "../lib/runtime.js";

export async function onRequest({ request, env }) {
  const u = new URL(request.url);
  if (request.method === "GET") {
    const t = String(u.searchParams.get("t") || ""); if (!/^[0-9a-f]{40}$/.test(t)) return page("That link is not valid.", "Open the link from the confirmation email again.", 403);
    const row = await env.DB.prepare("SELECT token, email, signup_id, verified_at, expires_at FROM email_verifications WHERE token = ?").bind(t).first().catch(() => null);
    if (!row) return page("That link is not valid.", "Ask for a new confirmation from the site.", 404);
    if (row.expires_at < new Date().toISOString()) return page("That link has expired.", "Ask for a new confirmation from the site.", 410);
    if (!row.verified_at) {
      await env.DB.prepare("UPDATE email_verifications SET verified_at = datetime('now') WHERE token = ?").bind(t).run();
      await env.DB.prepare("UPDATE signups SET email_verified_at = datetime('now') WHERE id = ?").bind(row.signup_id).run().catch(() => {});
    }
    const s = await env.DB.prepare("SELECT id, publication_url, email, plan_json, dispatch_status FROM signups WHERE id = ?").bind(row.signup_id).first().catch(() => null);
    if (!s) return page("We could not find that reservation.", "Write to caithrin@caithrin.com.", 404);
    if (s.dispatch_status === "dispatched" || s.dispatch_status === "done") return page("Already confirmed.", "Your proof is being made; it lands in your inbox in a few minutes.");
    const d = await dispatchPress(env, { event: "press", signup_id: s.id, publication_url: s.publication_url, email: s.email, plan_json: s.plan_json });
    await env.DB.prepare("UPDATE signups SET dispatch_status = ? WHERE id = ?").bind(d.ok ? "dispatched" : "queued", s.id).run().catch(() => {});
    await env.DB.prepare(`INSERT INTO press (signup_id, status, detail, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(signup_id) DO UPDATE SET status = excluded.status, detail = excluded.detail, updated_at = datetime('now')`)
      .bind(s.id, d.ok ? "building" : "queued", JSON.stringify({ message: d.ok ? "press started after verification" : "dispatch failed: " + (d.reason || d.status) })).run().catch(() => {});
    return page("Confirmed. Your proof is being made.", d.ok ? `It lands at ${s.email} in a few minutes: the first pages attached, the whole book linked, and a page to approve or change it.` : "A person starts the press by hand; the proof follows today.");
  }
  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  let b; try { b = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
  const id = Number(b.signup_id); if (!id) return json({ ok: false, error: "signup_id" }, 400);
  const s = await env.DB.prepare("SELECT id, publication_url, email, email_verified_at FROM signups WHERE id = ?").bind(id).first().catch(() => null);
  if (!s) return json({ ok: false, error: "not found" }, 404);
  const out = await sendVerification(env, s, u.origin);
  return json(out, out.ok ? 200 : out.status || 422);
}

/* send the confirmation to the publication's own address; used by signup and by the retry button */
export async function sendVerification(env, s, origin) {
  const id = s.id;
  const host = s.publication_url.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  const q = await spend(env, `verify:${host}`, LIMITS.verify_host); if (!q.ok) return { ok: false, status: 429, error: "too many confirmations for this publication this hour; try later" };
  const sub = await subdomainOf(host, env);
  if (!sub) return { ok: false, status: 422, error: "no_subdomain", message: "We could not find this publication's Substack address; use the About-page code instead." };
  const to = `${sub}@substack.com`;
  const token = [...crypto.getRandomValues(new Uint8Array(20))].map(x => x.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO email_verifications (token, email, signup_id, expires_at) VALUES (?, ?, ?, datetime('now', '+2 days'))").bind(token, to, id).run();
  const link = `${origin}/api/verify?t=${token}`;
  let sent = false;
  if (env.RESEND_API_KEY) {
    let message;
    try {
      message = prepareOutboundEmail(env, { from: "Inksheaf <press@inksheaf.com>", to: [to], reply_to: "caithrin@caithrin.com", subject: `Confirm your Inksheaf print run for ${host.replace(/^www\./, "")}`,
        text: `Someone (we hope you) asked Inksheaf to typeset ${host.replace(/^www\./, "")} into a printed book and reserved a proof for ${s.email}.\n\nIf that was you, confirm here and the proof is made:\n${link}\n\nIf it was not you, ignore this message; nothing is printed and nothing is sent to that address.\n\nThis went to ${to}, the address your publication sends from, because only the publication's owner receives it.\n\nInksheaf` });
    } catch (e) {
      return { ok: false, status: 503, error: String(e.message || e) };
    }
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(message) });
    sent = r.ok;
  }
  return { ok: true, sent_to: to, sent, fallback: "about-code" };
}
/* the publication's Substack subdomain from the archive's byline data */
async function subdomainOf(host, env) {
  if (/\.substack\.com$/.test(host)) return host.replace(/^www\./, "").split(".")[0];
  try {
    const a = await (await fetch(`https://${host}/api/v1/archive?sort=new&limit=3`, { headers: { accept: "application/json", "user-agent": "inksheaf-verify/1.0" } })).json();
    for (const p of Array.isArray(a) ? a : []) for (const b of p.publishedBylines || []) for (const pu of b.publicationUsers || []) { const pub = pu.publication; if (pub && pub.subdomain && (pub.id === p.publication_id)) return String(pub.subdomain).toLowerCase(); }
  } catch {}
  return null;
}
function page(h, p, status = 200) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Inksheaf</title>
<style>body{font-family:"EB Garamond",Garamond,Georgia,serif;background:#f7f3e9;color:#211c15;max-width:36rem;margin:14vh auto;padding:0 1.4rem;line-height:1.6}h1{font-weight:500;font-size:1.9rem}p{color:#4a4238}</style>
<h1>${h}</h1><p>${p}</p>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
