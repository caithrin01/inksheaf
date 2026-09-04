// GET /api/plan?url=<publication> — the editor's plan for a publication, made on request and
// kept in the preview cache. The page asks for it after the calendar plan has painted; the
// answer replaces the shelf when it lands. Idempotent: a plan already made is returned as is.
import { fetchArchive, parseHost, armFault } from "./preview.js";
import { planEdition } from "../lib/editor.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET") return json({ ok: false, error: "method not allowed" }, 405);
  const host = parseHost(new URL(request.url).searchParams.get("url") || "");
  if (!host) return json({ ok: false, error: "bad_host" }, 400);
  if (armFault(env) === "editor_fail") return json({ ok: false, error: "editor_failed" }, 502);
  if (!env.OPENROUTER_API_KEY && !env.ANTHROPIC_API_KEY) return json({ ok: false, error: "no_editor" }, 404);
  const cached = await env.DB.prepare("SELECT payload, fetched_at FROM preview_cache WHERE host = ?").bind(host).first().catch(() => null);
  const pay = cached ? JSON.parse(cached.payload) : null;
  if (pay && pay.summary_version === 7 && pay.editorial && pay.editorial.planned_by === "editor")
    return json({ ok: true, served: "cache", editorial: pay.editorial });
  /* one editor run per host at a time: a second caller within two minutes waits on the cache */
  const lock = await env.DB.prepare("SELECT created_at FROM events WHERE event = 'plan_start' AND session = ? AND created_at > datetime('now','-120 seconds') LIMIT 1").bind(host).first().catch(() => null);
  if (lock) return json({ ok: true, served: "pending", editorial: pay?.editorial || null, retry_in: 5 });
  await env.DB.prepare("INSERT INTO events (session, event) VALUES (?, 'plan_start')").bind(host).run().catch(() => {});
  const result = await fetchArchive(host, env);
  if (!result.ok) return json({ ok: false, error: result.error || "read_failed" }, result.status || 502);
  const posts = result.posts || [];
  const t0 = Date.now();
  const editorial = await planEdition({ posts, identity: result.identity, host, capped: !!result.data?.capped, apiKey: env.ANTHROPIC_API_KEY, openrouterKey: env.OPENROUTER_API_KEY, deadlineMs: 85000 - (Date.now() - t0) });
  editorial.editor_ms = Date.now() - t0; editorial.pending = false;
  await env.DB.prepare("INSERT INTO events (session, event) VALUES (?, ?)").bind(host, editorial.planned_by === "editor" ? "plan_editor" : "plan_calendar").run().catch(() => {});
  if (pay && pay.summary_version === 7) {
    pay.editorial = editorial;
    await env.DB.prepare("UPDATE preview_cache SET payload = ? WHERE host = ?").bind(JSON.stringify(pay), host).run().catch(() => {});
  }
  return json({ ok: true, served: "origin", editorial });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
