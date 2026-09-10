import { dispatchPress, hmacHex } from './press-dispatch.js';

// Reading a private edition is separate from permission to publish or sell it.
export async function editionLink(env, id) {
  return env.ARCHIVE_RELAY_TOKEN ? `/edition?id=${id}&sig=${await hmacHex(env.ARCHIVE_RELAY_TOKEN, `edition:${id}`)}` : null;
}
export async function startPrivatePdf(env, signup) {
  if (/\+journeytest@caithrin\.com$/i.test(signup.email)) return { press: 'test' };
  // Older completed reservations must never be rebuilt by a signup retry.
  const existing = await env.DB.prepare('SELECT id FROM edition_versions WHERE signup_id = ? LIMIT 1').bind(signup.id).first();
  if (existing) return { press: 'proofed' };
  const claim = await env.DB.prepare("UPDATE signups SET dispatch_status = 'dispatching' WHERE id = ? AND (dispatch_status IS NULL OR dispatch_status IN ('awaiting-verification','queued','verification-failed'))").bind(signup.id).run();
  if (claim.meta?.changes !== 1) {
    const current = await env.DB.prepare('SELECT dispatch_status FROM signups WHERE id = ?').bind(signup.id).first();
    return { press: current?.dispatch_status || 'queued' };
  }
  const result = await dispatchPress(env, { event: 'press', signup_id: signup.id,
    publication_url: signup.publication_url, email: signup.email, plan_json: signup.plan_json });
  const state = result.ok ? 'dispatched' : (result.status || result.reason === 'no dispatch token') ? 'queued' : 'dispatch-uncertain';
  await env.DB.prepare('UPDATE signups SET dispatch_status = ? WHERE id = ?').bind(state, signup.id).run();
  await env.DB.prepare("INSERT INTO press (signup_id,status,detail,updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(signup_id) DO UPDATE SET status=excluded.status,detail=excluded.detail,updated_at=datetime('now')")
    .bind(signup.id, 'queued', JSON.stringify({ message: result.ok ? 'Your book is in the press queue.' : 'Your request is saved. We are checking the start of your book.' })).run();
  return { press: state };
}

// Creation needs no verification click. Bound new work instead; an unavailable
// counter must not admit unmetered model/render jobs. Retries use the saved claim.
export async function reservePdfCapacity(env, { host, ip }) {
  const hour = new Date().toISOString().slice(0, 13);
  for (const [key, limit] of [[`pdf:host:${host}`, 3], [`pdf:${ip}`, 3], ['pdf:global', 12]]) {
    const result = await env.DB.prepare('INSERT INTO quota_hits (key,bucket,n) VALUES (?,?,1) ON CONFLICT(key,bucket) DO UPDATE SET n=n+1 WHERE n < ? RETURNING n')
      .bind(key, hour, limit).first();
    if (!result) return false;
  }
  return true;
}
