// POST /api/quote — price a mailing: the edition's volumes to each address, at cost.
// Body: { id, sig, level, addresses: [{ name, street1, street2?, city, state_code, postcode, quantity }] }
// sig = hmac("mail:<id>") from the listing email. Answers Lulu's own numbers per address, or
// the address error Lulu gives, never a guess. Nothing is ordered here.
import { hmacHex, mailingsEnabled } from "../lib/press-dispatch.js";
import { luluClient } from "../lib/lulu.js";
import prices from "../lib/print-prices.json" with { type: "json" };

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  let body; try { body = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
  if (!mailingsEnabled(env)) return json({ ok: false, error: "mailings are disabled for beta" }, 503);
  const id = Number(body.id), sig = String(body.sig || "");
  if (!id || !env.ARCHIVE_RELAY_TOKEN || sig !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `mail:${id}`)) return json({ ok: false, error: "bad link" }, 403);
  const row = await env.DB.prepare("SELECT plan_json, publication_url FROM signups WHERE id = ?").bind(id).first().catch(() => null);
  if (!row) return json({ ok: false, error: "not found" }, 404);
  let plan = null; try { plan = JSON.parse(row.plan_json || "null"); } catch {}
  const volumes = (plan && Array.isArray(plan.volumes) && plan.volumes.length) ? plan.volumes : null;
  if (!volumes || !volumes.every(v => v.est_pages)) return json({ ok: false, error: "no plan to price" }, 409);
  const pod = prices.pods[plan.interior === "color" ? "color" : "bw"].pod_package_id;
  const level = ["MAIL", "PRIORITY_MAIL", "GROUND", "EXPEDITED", "EXPRESS"].includes(body.level) ? body.level : "MAIL";
  const addresses = Array.isArray(body.addresses) ? body.addresses.slice(0, 50) : [];
  if (!addresses.length) return json({ ok: false, error: "no addresses" }, 400);
  const lulu = luluClient(env);
  const out = [];
  for (const a of addresses) {
    const qty = Math.max(1, Math.min(50, Number(a.quantity) || 1));
    const address = { name: String(a.name || "").slice(0, 80), street1: String(a.street1 || "").slice(0, 120), street2: String(a.street2 || "").slice(0, 120) || undefined,
      city: String(a.city || "").slice(0, 60), state_code: String(a.state_code || "").toUpperCase().slice(0, 2), postcode: String(a.postcode || "").slice(0, 12),
      country_code: "US", phone_number: String(a.phone || "+1 415 555 0100").slice(0, 24) };
    if (!address.name || !address.street1 || !address.city || !address.state_code || !address.postcode) { out.push({ address, ok: false, error: "name, street, city, state and ZIP are needed" }); continue; }
    const lineItems = volumes.map(v => ({ page_count: v.est_pages, pod_package_id: pod, quantity: qty }));
    if (!lulu) {
      /* no keys on this deploy: the measured cost table, so the page still shows numbers, marked estimated */
      const print = volumes.reduce((s, v) => s + (v.price ? v.price[plan.interior === "color" ? "color" : "bw"] : 0), 0) * qty;
      const ship = (prices.shipping_by_volumes[String(volumes.length)] || prices.shipping_mail) * qty;
      out.push({ address, ok: true, estimated: true, quantity: qty, print: r2(print), shipping: r2(ship), tax: null, total: r2(print + ship), currency: "USD" });
      continue;
    }
    try {
      const q = await lulu.costQuote({ lineItems, address, level });
      out.push({ address, ok: true, estimated: false, quantity: qty, print: num(q.total_cost_excl_tax) - num(q.shipping_cost?.total_cost_excl_tax), shipping: num(q.shipping_cost?.total_cost_excl_tax),
        tax: num(q.total_tax), total: num(q.total_cost_incl_tax), currency: q.currency || "USD", level });
    } catch (e) {
      out.push({ address, ok: false, error: e.status === 400 ? "Lulu could not use this address: " + (e.detail || "").slice(0, 160) : "Lulu did not answer; try again in a minute" });
    }
  }
  const good = out.filter(o => o.ok);
  const totals = { copies: good.reduce((s, o) => s + o.quantity, 0), print: r2(good.reduce((s, o) => s + o.print, 0)), shipping: r2(good.reduce((s, o) => s + o.shipping, 0)),
    tax: good.some(o => o.tax == null) ? null : r2(good.reduce((s, o) => s + o.tax, 0)), total: r2(good.reduce((s, o) => s + o.total, 0)), estimated: good.some(o => o.estimated) };
  return json({ ok: true, id, volumes: volumes.map(v => ({ label: v.label, pages: v.est_pages })), interior: plan.interior, level, quotes: out, totals, payment: env.STRIPE_SECRET_KEY ? "stripe" : "invoice" });
}
const num = x => Math.round((Number(x) || 0) * 100) / 100;
const r2 = x => Math.round(x * 100) / 100;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
