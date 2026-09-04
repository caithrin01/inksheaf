// POST /api/event — first-party funnel steps. The detailed ledger stores only a random browser
// session and the publication's public host; no IP, email or archive content.
import { funnelHost, recordFunnel, scheduleFunnelAlert } from "../lib/funnel.js";
const ALLOWED = new Set(["view","step2","step3","signup","preview_ok","preview_fail","preview_fetch",
  "reserve_start","plan_cadence","plan_interior","feedback"]);
export async function onRequest({ request, env, waitUntil }) {
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
  if (["preview_ok", "preview_fail", "reserve_start"].includes(event)) {
    const host = funnelHost(body.host);
    if (host) {
      const tracked = await recordFunnel(env, { session, host, event, automated: body.automated === true });
      if (tracked.alert) scheduleFunnelAlert(waitUntil, env, { ...tracked, stage: event });
    }
  }
  return new Response(null, { status: 204 });
}
