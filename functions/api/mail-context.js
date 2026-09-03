// GET /api/mail-context?id&sig -> the mailing screen's context, verified with the MAIL signature
// (hmac "mail:<id>"), not the change signature. Fixes the cross-capability mismatch where the mail
// screen opened /api/change with the mailing sig and was rejected (Codex control 2, audit P0-3).
// Returns the APPROVED edition's actual pages, consistent with /api/quote. Gated by the beta flag.
import { hmacHex, mailingsEnabled } from "../lib/press-dispatch.js";

export async function onRequest({ request, env }) {
  const u = new URL(request.url);
  const id = Number(u.searchParams.get("id")), sig = String(u.searchParams.get("sig") || "");
  if (!mailingsEnabled(env)) return json({ ok: false, error: "mailings are disabled for beta" }, 503);
  if (!id || !env.ARCHIVE_RELAY_TOKEN || sig !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `mail:${id}`)) return json({ ok: false, error: "bad link" }, 403);
  const row = await env.DB.prepare("SELECT publication_url FROM signups WHERE id = ?").bind(id).first().catch(() => null);
  if (!row) return json({ ok: false, error: "not found" }, 404);
  const ver = await env.DB.prepare(
    "SELECT volumes, print_mode FROM edition_versions WHERE signup_id = ? AND status IN ('approved','building-final','validated','listing-pending','listed') ORDER BY id DESC LIMIT 1")
    .bind(id).first().catch(() => null);
  if (!ver) return json({ ok: false, error: "no approved edition yet" }, 409);
  let volumes = []; try { volumes = JSON.parse(ver.volumes || "[]").map(v => ({ label: v.label, pages: Number(v.pages) })); } catch {}
  return json({ ok: true, id, publication_url: row.publication_url, interior: ver.print_mode === "color" ? "color" : "bw", volumes });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
