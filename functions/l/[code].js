// GET /l/<code> — a printed short link. 302 to the registered target and count the visit.
// Unknown codes answer a plain page, never a guess. No cookies, no IP stored.
export async function onRequest({ params, env, waitUntil }) {
  const code = String(params.code || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  if (!code) return notFound();
  const row = await env.DB.prepare("SELECT target FROM links WHERE code = ?").bind(code).first().catch(() => null);
  if (!row || !row.target) return notFound();
  /* the count outlives the response (Codex audit P1-2): handed to waitUntil, or awaited */
  const count = env.DB.prepare("UPDATE links SET hits = hits + 1, last_hit = datetime('now') WHERE code = ?").bind(code).run().catch(() => {});
  if (typeof waitUntil === "function") waitUntil(count); else await count;
  return new Response(null, { status: 302, headers: { location: row.target, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
const notFound = () => new Response(`<!doctype html><meta charset="utf-8"><title>Inksheaf</title><style>body{font:16px/1.5 Georgia,serif;max-width:32em;margin:4rem auto;padding:0 1rem;color:#1e1710;background:#f9f4e6}</style>
<h1>No such link</h1><p>This short link is not registered. Check the letters against the book; the address is printed beside them in the essay's link note.</p><p><a href="https://inksheaf.com">inksheaf.com</a></p>`, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
