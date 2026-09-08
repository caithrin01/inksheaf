// Approval of one edition version (Codex audit P0-1 and P0-5).
// GET  /api/approve?v=<version>&n=<nonce>  -> a page naming the version, its actual pages and the
//      print cost for this exact object, with one button. Nothing changes on GET, so a mail
//      scanner that opens the link approves nothing.
// POST /api/approve  (form: v, n)  -> consumes the nonce atomically: one row moves from
//      "proofed" to "approved" once; a second click, a replay or a stale link finds nothing to
//      approve. Then the final run is dispatched for that version id.
import { hmacHex, dispatchPress } from "../lib/press-dispatch.js";
import { printCost } from "../lib/editor-input.js";

export async function onRequest({ request, env }) {
  if (!["GET", "HEAD", "POST"].includes(request.method)) return page("Use the confirmation button.", "Open the link from your PDF email, then confirm explicitly on that page.", 405);
  const u = new URL(request.url);
  let v, n;
  if (request.method === "POST") { const f = await request.formData().catch(() => null); v = Number(f?.get("v")); n = String(f?.get("n") || ""); }
  else { v = Number(u.searchParams.get("v")); n = String(u.searchParams.get("n") || ""); }
  if (!v || !/^[0-9a-f]{36}$/.test(n)) return page("That approval link is not valid.", "Open the link from your proof email again, or write to caithrin@caithrin.com.", 403);
  const ver = await env.DB.prepare("SELECT id, signup_id, status, pages, print_mode, volumes, proof_sha256, approval_nonce, plan_json FROM edition_versions WHERE id = ?").bind(v).first().catch(() => null);
  if (!ver) return page("We could not find that proof.", "Write to caithrin@caithrin.com and we will sort it out.", 404);
  if (ver.status !== "proofed") {
    if (ver.status === "superseded") return page("A newer proof replaced this one.", "Open the link in your latest proof email; that is the edition that will print.");
    return page("Already approved.", "Your book is being prepared for the printer. The email with your mailing link follows when the files are validated.");
  }
  if (ver.approval_nonce !== n) return page("That approval link is not valid.", "Open the link from your proof email again, or write to caithrin@caithrin.com.", 403);
  let row, latest;
  try {
    row = await env.DB.prepare("SELECT publication_url, email, plan_json, email_verified_at FROM signups WHERE id = ?").bind(ver.signup_id).first();
    latest = await env.DB.prepare("SELECT id FROM edition_versions WHERE signup_id = ? ORDER BY id DESC LIMIT 1").bind(ver.signup_id).first();
  } catch { return page("We could not check this proof yet.", "Your approval has not been recorded. Please try the link again shortly.", 503); }
  if (!row?.email_verified_at) return page("Confirm your publication first.", "Publication ownership must be confirmed before these files can proceed. Write to caithrin@caithrin.com for help with this reservation.", 409);
  if (latest?.id !== ver.id || row.plan_json !== ver.plan_json) return page("This proof has changed.", "Your requested changes need a new PDF. Open the approval link in the new PDF email when it arrives.", 409);
  let volumes = []; try { volumes = JSON.parse(ver.volumes || "[]"); } catch {}
  const cost = volumes.reduce((s, x) => s + printCost(Number(x.pages) || 0, ver.print_mode), 0);
  const shape = volumes.length > 1 ? `${volumes.length} volumes: ${volumes.map(x => `${x.label}, ${x.pages} pages`).join("; ")}` : `${ver.pages} pages`;
  if (request.method === "GET" || request.method === "HEAD") {
    return page("Approve this proof?",
      `Edition version ${ver.id}: ${shape}, ${ver.print_mode === "color" ? "colour" : "black and white"} interior, print cost at Lulu $${cost.toFixed(2)} per copy before shipping. The book that prints is exactly the file you read (digest ${ver.proof_sha256.slice(0, 12)}…). If anything in it should change, use the change page first; approval cannot be undone.`,
      200, `<form method="post" action="/api/approve"><input type="hidden" name="v" value="${ver.id}"><input type="hidden" name="n" value="${n}"><button type="submit">Approve and send to the printer</button></form>`);
  }
  /* POST: the one atomic transition */
  const r = await env.DB.prepare(`UPDATE edition_versions SET status = 'approved', approved_at = datetime('now'), approval_nonce = NULL, approved_from = ?, updated_at = datetime('now')
    WHERE id = ? AND status = 'proofed' AND approval_nonce = ?
    AND EXISTS (SELECT 1 FROM signups s WHERE s.id = edition_versions.signup_id AND s.email_verified_at IS NOT NULL AND s.plan_json = edition_versions.plan_json)
    AND id = (SELECT MAX(newer.id) FROM edition_versions newer WHERE newer.signup_id = edition_versions.signup_id)`)
    .bind(String(request.headers.get("cf-connecting-ip") || "").slice(0, 64), ver.id, n).run().catch(() => null);
  if (!r || !r.meta) return page("We could not record that approval.", "Please try again shortly. Your PDF remains saved.", 503);
  if (r.meta.changes !== 1) return page("This approval is no longer available.", "It may already be recorded, or your requested changes may need a new PDF. Check your latest PDF email before continuing.", 409);
  await env.DB.prepare(`INSERT INTO press (signup_id, status, detail, updated_at) VALUES (?, 'approved', ?, datetime('now'))
    ON CONFLICT(signup_id) DO UPDATE SET status = 'approved', detail = excluded.detail, updated_at = datetime('now')`).bind(ver.signup_id, JSON.stringify({ version_id: ver.id })).run().catch(() => {});
  const d = await dispatchPress(env, { event: "list", signup_id: ver.signup_id, version_id: ver.id, publication_url: row.publication_url, email: row.email, plan_json: ver.plan_json });
  if (!d.ok) await env.DB.prepare("UPDATE edition_versions SET status = 'building-final', error = ?, updated_at = datetime('now') WHERE id = ?").bind("dispatch failed: " + (d.reason || d.status), ver.id).run().catch(() => {});
  return page("Approved.",
    d.ok ? `Version ${ver.id} goes to the printer's checks now. You will get an email with your mailing link when the files are validated, usually within the hour. A Lulu bookstore listing, if you want one, is set up by hand within one working day.`
         : "Your approval is saved. File preparation is waiting for follow-up. Nothing has been published or ordered.");
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function page(h, p, status = 200, extra = "") {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Inksheaf</title>
<style>body{font-family:"EB Garamond",Garamond,Georgia,serif;background:#f7f3e9;color:#211c15;max-width:36rem;margin:14vh auto;padding:0 1.4rem;line-height:1.6}h1{font-weight:500;font-size:1.9rem}p{color:#4a4238}button{font:inherit;padding:.6rem 1.1rem;background:#211c15;color:#f7f3e9;border:0;cursor:pointer}</style>
<h1>${escape(h)}</h1><p>${escape(p)}</p>${extra}`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
