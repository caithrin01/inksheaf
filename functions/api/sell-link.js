// POST /api/sell-link {id, sig, version_id, listing_url} — the creator's own Lulu product page,
// published by them from Inksheaf's files. Records it on the version and returns a short link
// that moves with later editions, and the button line for a Substack post. Signed "sell:<id>".
import { hmacHex } from "../lib/press-dispatch.js";
import { normalizeUrl, linkCode, SHORT_HOST } from "../lib/links.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  let b; try { b = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
  const id = Number(b.id), vid = Number(b.version_id);
  if (!id || !vid || !env.ARCHIVE_RELAY_TOKEN || String(b.sig || "") !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `sell:${id}`)) return json({ ok: false, error: "bad link" }, 403);
  const url = normalizeUrl(b.listing_url);
  if (!url || !/^https:\/\/(www\.)?lulu\.com\/shop\//.test(url)) return json({ ok: false, error: "Paste the address of your book's page on lulu.com; it starts with https://www.lulu.com/shop/" }, 400);
  const ver = await env.DB.prepare("SELECT id FROM edition_versions WHERE id = ? AND signup_id = ? AND status IN ('proofed','validated','listing-pending','listed')").bind(vid, id).first().catch(() => null);
  if (!ver) return json({ ok: false, error: "version not found" }, 404);
  const code = await linkCode(`edition:${id}`); /* one code per reservation: a new edition moves it */
  await env.DB.prepare(`INSERT INTO links (code, target, kind, signup_id, slug, letter) VALUES (?, ?, 'listing', ?, '', '')
    ON CONFLICT(code) DO UPDATE SET target = excluded.target, signup_id = excluded.signup_id`).bind(code, url, id).run();
  await env.DB.prepare("UPDATE edition_versions SET listing_url = ?, updated_at = datetime('now') WHERE id = ?").bind(url, vid).run();
  const short = `https://${SHORT_HOST}${code}`;
  return json({ ok: true, version_id: vid, listing_url: url, short,
    button_html: `<a href="${short}" style="display:inline-block;padding:.6em 1.1em;background:#1e1710;color:#f9f4e6;border-radius:4px;text-decoration:none;font-family:Georgia,serif">Order the book</a>` });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
