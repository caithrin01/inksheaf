// GET /api/watchdog?b=<5-minute bucket>&sig=hmac(token, `watchdog:${b}`) — called every 15 minutes
// by the health workflow. Finds books that were dispatched but never reached a finished or failed
// state in the time their plan needs, alerts the operator once per signup, and returns the list.
// A press runner that never starts (GitHub queue stalls, 2026-10-05 and 10-06) reports nothing
// at all; only this check notices it.
import { hmacHex } from '../lib/press-dispatch.js';
import { planVolumeCount } from '../lib/publisher-policy.js';
import { alertOperatorHeld, tellCreatorDelayed } from '../lib/press-alert.js';

export const MINUTES_PER_VOLUME = 25, GRACE_MINUTES = 10;
const DONE = new Set(['proofed', 'approved', 'building-final', 'validated', 'listing-pending', 'listed', 'failed', 'superseded']);
const json = (o, status = 200) => Response.json(o, { status, headers: { 'cache-control': 'no-store' } });

export async function stuckBooks(DB, nowMs = Date.now()) {
  const rows = (await DB.prepare(`SELECT s.id, s.publication_url, s.plan_json, s.created_at, p.status, p.updated_at
    FROM signups s LEFT JOIN press p ON p.signup_id = s.id
    WHERE s.dispatch_status = 'dispatched' AND s.created_at > datetime('now', '-3 days')`).all()).results || [];
  const stuck = [];
  for (const r of rows) {
    if (r.status && DONE.has(r.status)) continue;
    const since = Date.parse(String(r.updated_at || r.created_at).replace(' ', 'T') + 'Z');
    const allowed = (MINUTES_PER_VOLUME * planVolumeCount(r.plan_json) + GRACE_MINUTES) * 60000;
    if (Number.isFinite(since) && nowMs - since > allowed)
      stuck.push({ signup_id: r.id, publication: String(r.publication_url).replace(/^https?:\/\//, ''), status: r.status || 'never started', minutes: Math.round((nowMs - since) / 60000) });
  }
  return stuck;
}

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json({ ok: false }, 405);
  const u = new URL(request.url), b = Number(u.searchParams.get('b')), now = Math.floor(Date.now() / 300000);
  if (!env.ARCHIVE_RELAY_TOKEN || !Number.isSafeInteger(b) || Math.abs(now - b) > 1 || u.searchParams.get('sig') !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `watchdog:${b}`))
    return json({ ok: false }, 403);
  const stuck = await stuckBooks(env.DB);
  for (const s of stuck) {
    const told = await env.DB.prepare("SELECT 1 FROM events WHERE event = 'stuck_alert' AND session = ? LIMIT 1").bind(String(s.signup_id)).first().catch(() => null);
    if (told) continue;
    const sent = await alertOperatorHeld(env, { signupId: s.signup_id, message: `No result after ${s.minutes} minutes (last status: ${s.status}). The press may never have started.` });
    if (sent.sent) await env.DB.prepare("INSERT INTO events (session, event) VALUES (?, 'stuck_alert')").bind(String(s.signup_id)).run().catch(() => {});
    await tellCreatorDelayed(env, { signupId: s.signup_id });
  }
  return json({ ok: true, stuck });
}
