// Internal press callback. A PDF exists independently of its delivery; retries send the
// saved message for that edition and never dispatch a build, listing or order.
import { hmacHex } from '../lib/press-dispatch.js';
import { enqueueEmail, findEmailOperation, sendQueuedEmail, emailResult } from '../lib/email-outbox.js';
import { readLimitedText } from './preview.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);
  if (Number(request.headers.get('content-length') || 0) > 120_000) return json({ ok: false, error: 'message too large' }, 413);
  let body;
  try { body = JSON.parse(await readLimitedText(request, 120_000)); }
  catch { return json({ ok: false, error: 'invalid request' }, 400); }
  const id = Number(body.version_id);
  if (!Number.isSafeInteger(id) || id <= 0 || !env.ARCHIVE_RELAY_TOKEN || body.sig !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `proof-email:${id}`)) return json({ ok: false, error: 'unauthorized' }, 403);
  try {
    const version = await env.DB.prepare(`SELECT v.id, v.signup_id, v.status, v.plan_json AS version_plan, s.plan_json AS current_plan, s.email, s.email_verified_at
      FROM edition_versions v JOIN signups s ON s.id = v.signup_id WHERE v.id = ?`).bind(id).first();
    if (!version) return json({ ok: false, error: 'edition not found' }, 404);
    const key = `proof-ready/${id}/initial`;
    let row = await findEmailOperation(env, key);
    if (row && (row.version_id !== id || row.intended_to !== version.email)) return json({ ok: false, error: 'saved delivery requires review' }, 409);
    if (body.action === 'status') return json({ ok: true, version_id: id, edition_status: version.status, delivery: emailResult(row) });
    const latest = await env.DB.prepare('SELECT id FROM edition_versions WHERE signup_id = ? ORDER BY id DESC LIMIT 1').bind(version.signup_id).first();
    if (latest?.id !== id || version.status !== 'proofed' || version.version_plan !== version.current_plan) return json({ ok: false, error: 'this edition is no longer awaiting proof review' }, 409);
    if (body.action === 'retry' && !row) return json({ ok: false, error: 'no saved delivery operation exists; recover the original message first' }, 409);
    if (body.action && !['send', 'retry'].includes(body.action)) return json({ ok: false, error: 'invalid delivery action' }, 400);
    if (!row) row = await enqueueEmail(env, { operationKey: key, versionId: id, kind: 'proof-ready', recipient: version.email,
      message: { subject: body.subject, text: body.text, html: body.html } });
    const result = await sendQueuedEmail(env, row.id, { requireCurrentProof: true });
    return json({ ok: true, delivery: result }, result.accepted ? 200 : 202);
  } catch {
    return json({ ok: false, error: 'PDF delivery is delayed. The saved edition has not been rebuilt.' }, 503);
  }
}
const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
