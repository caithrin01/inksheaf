// POST /api/stripe-webhook — Stripe says a mailing is paid. Verifies the signature, marks the
// mailing paid, and starts the press run that places the print jobs (real money, only here).
import { dispatchPress, mailingsEnabled } from "../lib/press-dispatch.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  // fail closed for beta: no mailing is processed, and 200 so Stripe does not retry a dead route
  if (!mailingsEnabled(env)) return new Response("mailings disabled", { status: 200 });
  const raw = await request.text();
  const sigHeader = request.headers.get("stripe-signature") || "";
  if (!env.STRIPE_WEBHOOK_SECRET || !(await verify(raw, sigHeader, env.STRIPE_WEBHOOK_SECRET))) return new Response("bad signature", { status: 400 });
  const event = JSON.parse(raw);
  if (event.type !== "checkout.session.completed") return new Response("ignored", { status: 200 });
  const s = event.data.object;
  const mailingId = Number(s.metadata?.mailing_id), signupId = Number(s.metadata?.signup_id);
  if (!mailingId) return new Response("no mailing", { status: 200 });
  // One Stripe event is acted on once; a redelivery finds its claim and stops.
  const claim = await env.DB.prepare("INSERT INTO stripe_events (id, type, mailing_id, outcome) VALUES (?, ?, ?, 'claimed') ON CONFLICT(id) DO NOTHING")
    .bind(String(event.id || ""), event.type, mailingId).run().catch(() => null);
  if (!event.id || !claim || !claim.meta?.changes) return new Response("already", { status: 200 });
  const m = await env.DB.prepare("SELECT id, signup_id, status, addresses, level, version_id, amount_cents FROM mailings WHERE id = ?").bind(mailingId).first().catch(() => null);
  if (!m || m.status !== "checkout") return new Response("already", { status: 200 });
  // The amount paid must be the amount agreed for this mailing.
  if (Number.isSafeInteger(m.amount_cents) && Number(s.amount_total) !== m.amount_cents) {
    await env.DB.prepare("UPDATE stripe_events SET outcome = 'amount-mismatch' WHERE id = ?").bind(String(event.id)).run().catch(() => {});
    return new Response("amount mismatch", { status: 200 });
  }
  const moved = await env.DB.prepare("UPDATE mailings SET status = 'paid', paid_at = datetime('now'), stripe_payment = ?, stripe_event_id = ? WHERE id = ? AND status = 'checkout'")
    .bind(String(s.payment_intent || s.id), String(event.id), mailingId).run();
  if (!moved.meta?.changes) return new Response("already", { status: 200 });
  const row = await env.DB.prepare("SELECT email, publication_url, plan_json FROM signups WHERE id = ?").bind(signupId || m.signup_id).first().catch(() => null);
  // Print exactly the version that was priced and paid for, from its own validated files.
  const ver = m.version_id ? await env.DB.prepare("SELECT files_json FROM edition_versions WHERE id = ? AND signup_id = ?").bind(m.version_id, m.signup_id).first().catch(() => null) : null;
  let files = null; try { files = JSON.parse(ver?.files_json || "null"); } catch {}
  const sent = await dispatchPress(env, { event: "mail", signup_id: signupId || m.signup_id, mailing_id: mailingId, publication_url: row?.publication_url, email: row?.email,
    addresses: JSON.parse(m.addresses || "[]"), level: m.level, plan_json: row?.plan_json || null, files: files ? JSON.stringify({ files, version_id: m.version_id }) : null });
  if (!sent?.ok) {
    // The print run did not start. Release the claim and return the mailing to checkout, so
    // Stripe's own retry of this event starts it again; nothing is lost or doubled.
    await env.DB.prepare("UPDATE mailings SET status = 'checkout' WHERE id = ? AND status = 'paid'").bind(mailingId).run().catch(() => {});
    await env.DB.prepare("DELETE FROM stripe_events WHERE id = ?").bind(String(event.id)).run().catch(() => {});
    return new Response("dispatch failed; retry", { status: 503 });
  }
  await env.DB.prepare("UPDATE stripe_events SET outcome = 'dispatched' WHERE id = ?").bind(String(event.id)).run().catch(() => {});
  return new Response("ok", { status: 200 });
}
async function verify(payload, header, secret) {
  const parts = Object.fromEntries(header.split(",").map(p => p.split("=")));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1 || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === v1;
}
