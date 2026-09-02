// POST /api/stripe-webhook — Stripe says a mailing is paid. Verifies the signature, marks the
// mailing paid, and starts the press run that places the print jobs (real money, only here).
import { dispatchPress } from "../lib/press-dispatch.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  const raw = await request.text();
  const sigHeader = request.headers.get("stripe-signature") || "";
  if (!env.STRIPE_WEBHOOK_SECRET || !(await verify(raw, sigHeader, env.STRIPE_WEBHOOK_SECRET))) return new Response("bad signature", { status: 400 });
  const event = JSON.parse(raw);
  if (event.type !== "checkout.session.completed") return new Response("ignored", { status: 200 });
  const s = event.data.object;
  const mailingId = Number(s.metadata?.mailing_id), signupId = Number(s.metadata?.signup_id);
  if (!mailingId) return new Response("no mailing", { status: 200 });
  const m = await env.DB.prepare("SELECT id, signup_id, status, addresses, level FROM mailings WHERE id = ?").bind(mailingId).first().catch(() => null);
  if (!m || m.status === "paid" || m.status === "printing") return new Response("already", { status: 200 });
  await env.DB.prepare("UPDATE mailings SET status = 'paid', paid_at = datetime('now'), stripe_payment = ? WHERE id = ?").bind(String(s.payment_intent || s.id), mailingId).run();
  const row = await env.DB.prepare("SELECT email, publication_url, plan_json FROM signups WHERE id = ?").bind(signupId || m.signup_id).first().catch(() => null);
  const press = await env.DB.prepare("SELECT detail FROM press WHERE signup_id = ?").bind(signupId || m.signup_id).first().catch(() => null);
  await dispatchPress(env, { event: "mail", signup_id: signupId || m.signup_id, mailing_id: mailingId, publication_url: row?.publication_url, email: row?.email,
    addresses: JSON.parse(m.addresses || "[]"), level: m.level, plan_json: row?.plan_json || null, files: press?.detail || null });
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
