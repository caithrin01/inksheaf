// POST /api/event — funnel step counters. Stores event name + random session id only.
const ALLOWED = new Set(["view","step2","step3","signup","preview_ok","preview_fail","preview_fetch"]);
export async function onRequest({ request, env }) {
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  let body;
  try { body = await request.json(); } catch { return new Response(null, { status: 204 }); }
  const event = String(body.event || "");
  if (!ALLOWED.has(event)) return new Response(null, { status: 204 });
  const session = String(body.session || "").slice(0, 16);
  if (!/^[a-z0-9]{6,16}$/.test(session)) return new Response(null, { status: 204 });
  const recent = await env.DB.prepare(
    "SELECT count(*) n FROM events WHERE created_at > datetime('now','-60 seconds')"
  ).first().catch(() => ({ n: 0 }));
  if ((recent?.n || 0) >= 300) return new Response(null, { status: 204 });
  await env.DB.prepare("INSERT INTO events (session, event) VALUES (?,?)")
    .bind(session, event).run();
  return new Response(null, { status: 204 });
}
