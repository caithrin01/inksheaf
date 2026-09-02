// POST /api/listed {signup_id, version_id, listing_url, sig: hmac("listed:<signup>")}
// The operator's completion action for the hand-made Lulu listing (beta): the version becomes
// "listed", a short link inksheaf.com/l/<code> points at the listing (so a later edition can
// move it), and the writer gets the email with the link, the short link and a Substack button.
import { hmacHex } from "../lib/press-dispatch.js";
import { normalizeUrl, linkCode, SHORT_HOST } from "../lib/links.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  let b; try { b = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
  const id = Number(b.signup_id), vid = Number(b.version_id);
  if (!id || !vid || !env.ARCHIVE_RELAY_TOKEN || String(b.sig || "") !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `listed:${id}`)) return json({ ok: false, error: "bad signature" }, 403);
  const url = normalizeUrl(b.listing_url);
  if (!url || !/^https:\/\/(www\.)?lulu\.com\//.test(url)) return json({ ok: false, error: "listing_url must be a lulu.com page" }, 400);
  const ver = await env.DB.prepare("SELECT id, signup_id, status, volumes, pages, print_mode, quote_json FROM edition_versions WHERE id = ? AND signup_id = ?").bind(vid, id).first().catch(() => null);
  if (!ver) return json({ ok: false, error: "version not found" }, 404);
  if (!["validated", "listing-pending", "listed"].includes(ver.status)) return json({ ok: false, error: `version is ${ver.status}` }, 409);
  const row = await env.DB.prepare("SELECT publication_url, email FROM signups WHERE id = ?").bind(id).first().catch(() => null);
  if (!row) return json({ ok: false, error: "reservation not found" }, 404);
  const code = await linkCode(`edition:${id}`); /* one code per reservation: a new edition moves it */
  await env.DB.prepare(`INSERT INTO links (code, target, kind, signup_id, slug, letter) VALUES (?, ?, 'listing', ?, '', '')
    ON CONFLICT(code) DO UPDATE SET target = excluded.target, signup_id = excluded.signup_id`).bind(code, url, id).run();
  await env.DB.prepare("UPDATE edition_versions SET status = 'listed', listing_url = ?, updated_at = datetime('now') WHERE id = ?").bind(url, vid).run();
  await env.DB.prepare(`INSERT INTO press (signup_id, status, detail, updated_at) VALUES (?, 'listed', ?, datetime('now')) ON CONFLICT(signup_id) DO UPDATE SET status = 'listed', detail = excluded.detail, updated_at = datetime('now')`)
    .bind(id, JSON.stringify({ version_id: vid, listing_url: url, short: `${SHORT_HOST}${code}` })).run().catch(() => {});
  let vols = []; try { vols = JSON.parse(ver.volumes || "[]"); } catch {}
  let quote = null; try { quote = JSON.parse(ver.quote_json || "null"); } catch {}
  const pub = vols[0]?.pubName || row.publication_url.replace(/^https?:\/\//, "");
  const short = `https://${SHORT_HOST}${code}`;
  const text = `Your book is on Lulu, at cost.

${pub}, ${vols.map(v => `${v.label} (${v.pages} pages)`).join("; ")}, ${ver.print_mode === "color" ? "colour" : "black and white"}. Price on the page: ${quote ? "$" + Number(quote.print_cost).toFixed(2) : "the print cost"} per copy, which is Lulu's print cost with nothing added; Lulu adds its own shipping at checkout.

Order copies here, and send readers the same link:
${url}

A short link that stays the same if you print a new edition, for print or post:
${short}

For a button in your Substack post or email, add a button block with this address and a label such as "Order the book". Or paste this line:
<a href="${short}" style="display:inline-block;padding:.6em 1.1em;background:#1e1710;color:#f9f4e6;border-radius:4px;text-decoration:none;font-family:Georgia,serif">Order the book</a>

Want to change the book? Reply to this email. A new edition gets a new page, and the short link moves to it.

Inksheaf`;
  let mail = { ok: false };
  if (env.RESEND_API_KEY) {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "Inksheaf <press@inksheaf.com>", to: [row.email], reply_to: "caithrin@caithrin.com", subject: `Your book is on Lulu: ${pub}`, text }) });
    mail = { ok: r.ok, status: r.status };
  }
  return json({ ok: true, version_id: vid, listing_url: url, short, mail });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
