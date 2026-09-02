// GET /api/approve?id=<signup>&sig=<hmac> — the writer approves the proof from the email.
// Records the approval and starts the listing run. The link is signed with the relay token,
// so it cannot be guessed; approving twice is harmless.
import { hmacHex, dispatchPress } from "../lib/press-dispatch.js";

export async function onRequest({ request, env }) {
  const u = new URL(request.url);
  const id = Number(u.searchParams.get("id")), sig = u.searchParams.get("sig") || "";
  if (!id || !env.ARCHIVE_RELAY_TOKEN || sig !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `approve:${id}`))
    return page("That approval link is not valid.", "Open the link from your proof email again, or write to caithrin@caithrin.com.", 403);
  const row = await env.DB.prepare("SELECT id, publication_url, email, plan_json FROM signups WHERE id = ?").bind(id).first().catch(() => null);
  if (!row) return page("We could not find that reservation.", "Write to caithrin@caithrin.com and we will sort it out.", 404);
  const press = await env.DB.prepare("SELECT status FROM press WHERE signup_id = ?").bind(id).first().catch(() => null);
  if (press && ["approved", "listing", "listed"].includes(press.status))
    return page("Already approved.", press.status === "listed" ? "Your listing email has the link." : "Your book is on its way to the printer; the listing email follows within the hour.");
  await env.DB.prepare(`INSERT INTO press (signup_id, status, detail, updated_at) VALUES (?, 'approved', '{}', datetime('now'))
    ON CONFLICT(signup_id) DO UPDATE SET status = 'approved', updated_at = datetime('now')`).bind(id).run().catch(() => {});
  const d = await dispatchPress(env, { event: "list", signup_id: id, publication_url: row.publication_url, email: row.email, plan_json: row.plan_json });
  return page("Approved. Your book goes to the printer now.",
    d.ok ? "Within the hour you will get an email with the Lulu link, the price at cost, and how to mail copies to readers."
         : "We have your approval. The listing is being made by hand; the email with the link follows today.");
}
function page(h, p, status = 200) {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Inksheaf</title>
<style>body{font-family:"EB Garamond",Garamond,Georgia,serif;background:#f7f3e9;color:#211c15;max-width:36rem;margin:14vh auto;padding:0 1.4rem;line-height:1.6}h1{font-weight:500;font-size:1.9rem}p{color:rgba(33,28,21,.75)}</style>
<h1>${h}</h1><p>${p}</p>`, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
