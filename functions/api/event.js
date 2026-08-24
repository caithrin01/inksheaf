// POST /api/event — funnel step counters. Stores event name + random session id only.
const ALLOWED = new Set(["view","step2","step3","signup"]);
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return new Response(null, { status: 204 }); }
  const event = String(body.event || "");
  if (!ALLOWED.has(event)) return new Response(null, { status: 204 });
  const session = String(body.session || "").slice(0, 16);
  await env.DB.prepare("INSERT INTO events (session, event) VALUES (?,?)")
    .bind(session, event).run();
  return new Response(null, { status: 204 });
}
