// POST /api/quote — price a mailing: the edition's volumes to each address, at cost.
// Body: { id, sig, level, addresses: [{ name, street1, street2?, city, state_code, postcode, quantity }] }
// sig = hmac("mail:<id>") from the listing email. Answers Lulu's own numbers per address, or
// the address error Lulu gives, never a guess. Nothing is ordered here.
import { hmacHex, mailingsEnabled } from "../lib/press-dispatch.js";
import { luluClient } from "../lib/lulu.js";
import { printCost } from "../lib/editor-input.js";
import prices from "../lib/print-prices.json" with { type: "json" };

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  let body; try { body = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
  if (!mailingsEnabled(env)) return json({ ok: false, error: "mailings are disabled for beta" }, 503);
  const id = Number(body.id), sig = String(body.sig || "");
  if (!id || !env.ARCHIVE_RELAY_TOKEN || sig !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `mail:${id}`)) return json({ ok: false, error: "bad link" }, 403);
  // Price the APPROVED edition by its ACTUAL page count, never the plan estimate (Codex control 1,
  // audit P0-2). A mailing prices the immutable finalized book; if none exists, refuse rather than
  // quote off an estimate. The plan-page range stays labelled "estimated" for the pre-proof view.
  const ver = await env.DB.prepare(
    "SELECT id, pages, volumes, print_mode, quote_json, status, files_json FROM edition_versions WHERE signup_id = ? AND status IN ('proofed','approved','building-final','validated','listing-pending','listed') ORDER BY id DESC LIMIT 1")
    .bind(id).first().catch(() => null);
  if (!ver) return json({ ok: false, error: "your book is not finished yet" }, 409);
  // The newest finished book is the one priced. Its print files must have passed Lulu's
  // checks; an older version is never priced in its place.
  let files = null; try { files = JSON.parse(ver.files_json || "null"); } catch {}
  const printReady = Array.isArray(files) && files.length > 0 && files.every(f => f.validated && f.interiorKey && f.coverKey);
  if (ver.status === "proofed" && !printReady)
    return json({ ok: false, code: files ? "print-files-review" : "print-files-pending",
      error: files ? "The printer's file checks need a person to look at them. We have been told and will email you." : "The printer is checking your book's files. Ordering opens in a few minutes." }, 409);
  let volumes = []; try { volumes = JSON.parse(ver.volumes || "[]"); } catch {}
  if (!volumes.length || !volumes.every(v => Number(v.pages) > 0)) return json({ ok: false, error: "the approved edition has no page count" }, 409);
  let storedQuote = null; try { storedQuote = JSON.parse(ver.quote_json || "null"); } catch {}
  const interior = ver.print_mode === "color" ? "color" : "bw";
  const pod = prices.pods[interior].pod_package_id;
  const level = ["MAIL", "PRIORITY_MAIL", "GROUND", "EXPEDITED", "EXPRESS"].includes(body.level) ? body.level : "MAIL";
  const addresses = Array.isArray(body.addresses) ? body.addresses.slice(0, 50) : [];
  if (!addresses.length) return json({ ok: false, error: "no addresses" }, 400);
  const lulu = luluClient(env);
  // Inksheaf's addition is per printed book: a two-volume set is two books.
  const perBook = Number(prices.inksheaf_per_book) || 0;
  const out = [];
  for (const a of addresses) {
    const qty = Math.max(1, Math.min(50, Number(a.quantity) || 1));
    const address = { name: String(a.name || "").slice(0, 80), street1: String(a.street1 || "").slice(0, 120), street2: String(a.street2 || "").slice(0, 120) || undefined,
      city: String(a.city || "").slice(0, 60), state_code: String(a.state_code || "").toUpperCase().slice(0, 2), postcode: String(a.postcode || "").slice(0, 12),
      country_code: String(a.country_code || "US").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) || "US", phone_number: String(a.phone || "+1 415 555 0100").slice(0, 24) };
    // Lulu needs a state or province for these countries; elsewhere it is optional.
    const needsState = ["US", "CA", "AU"].includes(address.country_code);
    if (!address.state_code) delete address.state_code;
    if (!address.name || !address.street1 || !address.city || !address.postcode || (needsState && !address.state_code)) { out.push({ address, ok: false, error: needsState ? "name, street, city, state and postcode are needed" : "name, street, city and postcode are needed" }); continue; }
    const lineItems = volumes.map(v => ({ page_count: Number(v.pages), pod_package_id: pod, quantity: qty }));
    if (!lulu) {
      /* no keys on this deploy: the measured cost table, so the page still shows numbers, marked estimated */
      const perCopy = storedQuote && Number(storedQuote.print_cost) > 0 ? Number(storedQuote.print_cost) : volumes.reduce((s, v) => s + printCost(Number(v.pages), interior), 0);
      const print = perCopy * qty;
      const ship = (prices.shipping_by_volumes[String(volumes.length)] || prices.shipping_mail) * qty;
      const fee = r2(perBook * qty * volumes.length);
      out.push({ address, ok: true, estimated: true, quantity: qty, print: r2(print), shipping: r2(ship), tax: null, lulu_total: r2(print + ship), inksheaf: fee, total: r2(print + ship + fee), currency: "USD" });
      continue;
    }
    try {
      const q = await lulu.costQuote({ lineItems, address, level });
      const fee = r2(perBook * qty * volumes.length);
      out.push({ address, ok: true, estimated: false, quantity: qty, print: num(q.total_cost_excl_tax) - num(q.shipping_cost?.total_cost_excl_tax), shipping: num(q.shipping_cost?.total_cost_excl_tax),
        tax: num(q.total_tax), lulu_total: num(q.total_cost_incl_tax), inksheaf: fee, total: r2(num(q.total_cost_incl_tax) + fee), currency: q.currency || "USD", level });
    } catch (e) {
      const detail = String(e.detail || "");
      out.push({ address, ok: false, error: e.status === 400 && /no shipping option/i.test(detail) ? "This shipping speed is not available for this book to this address. Choose another speed and price it again."
        : e.status === 400 ? "Lulu could not use this address: " + detail.slice(0, 160) : "Lulu did not answer; try again in a minute" });
    }
  }
  const good = out.filter(o => o.ok);
  const totals = { copies: good.reduce((s, o) => s + o.quantity, 0), print: r2(good.reduce((s, o) => s + o.print, 0)), shipping: r2(good.reduce((s, o) => s + o.shipping, 0)),
    tax: good.some(o => o.tax == null) ? null : r2(good.reduce((s, o) => s + o.tax, 0)), lulu_total: r2(good.reduce((s, o) => s + o.lulu_total, 0)),
    inksheaf: r2(good.reduce((s, o) => s + o.inksheaf, 0)), books: good.reduce((s, o) => s + o.quantity * volumes.length, 0), per_book: perBook,
    total: r2(good.reduce((s, o) => s + o.total, 0)), estimated: good.some(o => o.estimated) };
  return json({ ok: true, id, version_id: ver.id, print_ready: printReady, volumes: volumes.map(v => ({ label: v.label, pages: Number(v.pages) })), interior, level, quotes: out, totals, estimated_price: totals.estimated, payment: env.STRIPE_SECRET_KEY ? "stripe" : "invoice" });
}
const num = x => Math.round((Number(x) || 0) * 100) / 100;
const r2 = x => Math.round(x * 100) / 100;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
