// GET /api/sell-context?id&sig -> what a creator needs to publish this book in their own Lulu
// account: the validated print files, Lulu's exact settings, the measured print cost and
// Inksheaf's payee details. Signed with hmac("sell:<id>"). Nothing is published from here.
import { hmacHex } from "../lib/press-dispatch.js";
import { printCost } from "../lib/editor-input.js";
import prices from "../lib/print-prices.json" with { type: "json" };

export async function onRequest({ request, env }) {
  const u = new URL(request.url), id = Number(u.searchParams.get("id")), sig = String(u.searchParams.get("sig") || "");
  if (!id || !env.ARCHIVE_RELAY_TOKEN || sig !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `sell:${id}`)) return json({ ok: false, error: "bad link" }, 403);
  const row = await env.DB.prepare("SELECT publication_url FROM signups WHERE id = ?").bind(id).first().catch(() => null);
  if (!row) return json({ ok: false, error: "not found" }, 404);
  const ver = await env.DB.prepare("SELECT id, volumes, print_mode, status, files_json, listing_url FROM edition_versions WHERE signup_id = ? AND status IN ('proofed','validated','listing-pending','listed') ORDER BY id DESC LIMIT 1")
    .bind(id).first().catch(() => null);
  if (!ver) return json({ ok: false, error: "your book is not finished yet" }, 409);
  let files = null, vols = []; try { files = JSON.parse(ver.files_json || "null"); vols = JSON.parse(ver.volumes || "[]"); } catch {}
  const ready = Array.isArray(files) && files.length > 0 && files.every(f => f.validated && f.interiorUrl && f.coverUrl);
  if (!ready) return json({ ok: true, id, ready: false, pending: ver.status === "proofed" && !files });
  const interior = ver.print_mode === "color" ? "color" : "bw";
  const expires = files.map(f => Date.parse(f.links_expire_at)).filter(Number.isFinite);
  return json({ ok: true, id, ready: true, version_id: ver.id, publication_url: row.publication_url, pub_name: vols[0]?.pubName || null,
    listing_url: ver.listing_url || null, per_book: Number(prices.inksheaf_per_book) || 0,
    payee_email: env.INKSHEAF_LULU_PAYEE_EMAIL || null,
    links_expired: expires.length > 0 && Math.min(...expires) <= Date.now(),
    settings: { size: "US Trade, 6 × 9 in (152 × 229 mm)", binding: "Paperback, perfect bound",
      interior: interior === "color" ? "Standard color" : "Standard black & white", paper: "60# white", cover: "Matte", pod_package_id: prices.pods[interior].pod_package_id },
    volumes: files.map((f, i) => ({ label: f.label, title: vols[i]?.title || null, subtitle: vols[i]?.subtitle || null, pages: f.pages,
      print_cost: printCost(f.pages, interior), interior_url: f.interiorUrl, cover_url: f.coverUrl })) });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
