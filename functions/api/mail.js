// POST /api/mail — the writer confirms a mailing. Re-quotes with Lulu, records the mailing,
// then either opens a Stripe Checkout (keys present) or sends the invoice by email through
// the press. Print jobs are placed only after payment, by the press, never from here.
import { hmacHex, dispatchPress } from "../lib/press-dispatch.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  let body; try { body = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
  const id = Number(body.id), sig = String(body.sig || "");
  if (!id || !env.ARCHIVE_RELAY_TOKEN || sig !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `mail:${id}`)) return json({ ok: false, error: "bad link" }, 403);
  /* the quote endpoint is the one source of prices; ask it the same question */
  const qr = await fetch(new URL("/api/quote", request.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const quote = await qr.json().catch(() => ({}));
  if (!quote.ok) return json({ ok: false, error: quote.error || "could not price" }, 409);
  if (quote.quotes.some(x => !x.ok) || !quote.totals.copies) return json({ ok: false, error: "fix the addresses first" }, 400);
  const row = await env.DB.prepare("SELECT email, publication_url FROM signups WHERE id = ?").bind(id).first().catch(() => null);
  if (!row) return json({ ok: false, error: "not found" }, 404);
  const res = await env.DB.prepare("INSERT INTO mailings (signup_id, level, addresses, quote, status) VALUES (?, ?, ?, ?, 'quoted')")
    .bind(id, quote.level, JSON.stringify(quote.quotes.map(x => ({ ...x.address, quantity: x.quantity }))), JSON.stringify({ totals: quote.totals, volumes: quote.volumes, interior: quote.interior })).run();
  const mailingId = res.meta?.last_row_id;
  const total = quote.totals.total;
  if (env.STRIPE_SECRET_KEY) {
    const form = new URLSearchParams({ mode: "payment", "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(Math.round(total * 100)),
      "line_items[0][price_data][product_data][name]": `${quote.totals.copies} ${quote.volumes.length === 1 ? "copies" : "sets"} of ${row.publication_url.replace(/^https?:\/\//, "")}, printed and mailed at cost`,
      success_url: `${new URL(request.url).origin}/mail?id=${id}&sig=${sig}&paid=${mailingId}`, cancel_url: `${new URL(request.url).origin}/mail?id=${id}&sig=${sig}`,
      customer_email: row.email, "metadata[mailing_id]": String(mailingId), "metadata[signup_id]": String(id) });
    const sr = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" }, body: form });
    const session = await sr.json().catch(() => ({}));
    if (!sr.ok || !session.url) return json({ ok: false, error: "payment could not start" }, 502);
    await env.DB.prepare("UPDATE mailings SET stripe_session = ?, status = 'checkout' WHERE id = ?").bind(session.id, mailingId).run().catch(() => {});
    return json({ ok: true, mailing_id: mailingId, checkout_url: session.url });
  }
  await env.DB.prepare("UPDATE mailings SET status = 'invoiced' WHERE id = ?").bind(mailingId).run().catch(() => {});
  await dispatchPress(env, { event: "invoice", signup_id: id, mailing_id: mailingId, publication_url: row.publication_url, email: row.email,
    invoice: { level: quote.level, totals: quote.totals, quotes: quote.quotes.map(x => ({ name: x.address.name, city: x.address.city, state: x.address.state_code, quantity: x.quantity, total: x.total })) } });
  return json({ ok: true, mailing_id: mailingId, payment: "invoice" });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
