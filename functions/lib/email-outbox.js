import { prepareOutboundEmail, runtimeMode, stagingInbox } from './runtime.js';

const encoder = new TextEncoder();
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000; // Margin inside the provider's 24-hour window.
const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
const validEmail = value => typeof value === 'string' && /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(value);
const get = (env, id) => env.DB.prepare('SELECT * FROM email_outbox WHERE id = ?').bind(id).first();

export async function findEmailOperation(env, operationKey) {
  return env.DB.prepare('SELECT * FROM email_outbox WHERE operation_key = ?').bind(operationKey).first();
}

// Caller supplies an already-authorized edition and recipient. No public route accepts a
// caller-supplied recipient or message. Persist before sending; a retry uses these exact bytes.
export async function enqueueEmail(env, { operationKey, versionId, kind, recipient, message }, { now = Date.now() } = {}) {
  if (typeof operationKey !== 'string' || !/^[a-zA-Z0-9:/._-]{1,180}$/.test(operationKey)) throw new Error('Invalid email operation key');
  if (!Number.isSafeInteger(versionId) || versionId <= 0 || !/^[a-z-]{1,40}$/.test(kind || '')) throw new Error('Invalid email edition or event');
  if (!validEmail(recipient)) throw new Error('Exactly one valid recipient is required');
  if (!message || typeof message.subject !== 'string' || !message.subject.trim() || typeof message.text !== 'string' || !message.text.trim()) throw new Error('Email subject and plain text are required');
  if (message.attachments?.length) throw new Error('This outbox delivers complete PDFs through private links');
  const raw = { from: 'Inksheaf <press@inksheaf.com>', to: [recipient], reply_to: 'caithrin@caithrin.com',
    subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {}) };
  const prepared = prepareOutboundEmail(env, raw);
  const body = JSON.stringify(prepared);
  if (encoder.encode(body).length > 100_000) throw new Error('Email message is too large');
  const hash = await digest(body), mode = runtimeMode(env);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO email_outbox
    (id, operation_key, version_id, kind, intended_to, runtime_mode, message_json, message_sha256, created_ms, updated_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(operation_key) DO NOTHING`)
    .bind(id, operationKey, versionId, kind, recipient, mode, body, hash, now, now).run();
  const row = await findEmailOperation(env, operationKey);
  if (!row) throw new Error('Email operation was not saved');
  if (row.version_id !== versionId || row.kind !== kind || row.intended_to !== recipient || row.runtime_mode !== mode || row.message_sha256 !== hash) throw new Error('Email operation conflicts with the saved message');
  return row;
}

export function emailResult(row) {
  return { ok: row?.send_status === 'accepted', accepted: row?.send_status === 'accepted',
    status: row?.send_status || 'missing', delivery: row?.delivery_status || null,
    id: row?.id || null, provider_id: row?.provider_id || null };
}

export async function sendQueuedEmail(env, id, { now = Date.now(), fetcher = fetch } = {}) {
  let row = await get(env, id);
  if (!row) throw new Error('Email operation not found');
  // Even accepted-message replays are checked before exposing any result across environments.
  let message;
  try { message = JSON.parse(row.message_json); } catch { throw new Error('Saved email is invalid'); }
  const expectedRecipient = runtimeMode(env) === 'production' ? row.intended_to : stagingInbox(env);
  if (row.runtime_mode !== runtimeMode(env) || !expectedRecipient || message.to?.length !== 1 || message.to[0] !== expectedRecipient || await digest(row.message_json) !== row.message_sha256) throw new Error('Saved email does not match this environment or recipient');
  if (['accepted', 'reconcile', 'cancelled'].includes(row.send_status)) return emailResult(row);
  if (row.send_status === 'sending' && row.lease_started_ms > now - LEASE_MS) return emailResult(row);
  if (row.attempts >= MAX_ATTEMPTS) {
    await env.DB.prepare("UPDATE email_outbox SET send_status = 'reconcile', last_error = 'Retry limit reached; delivery needs review', updated_ms = ? WHERE id = ? AND send_status IN ('queued','failed','uncertain','sending') AND (lease_started_ms IS NULL OR lease_started_ms <= ? OR send_status != 'sending')")
      .bind(now, id, now - LEASE_MS).run();
    return emailResult(await get(env, id));
  }
  // Unknown acceptance cannot be replayed after provider deduplication expires. A definite
  // rejection remains retryable; the provider never accepted that request.
  if (['uncertain', 'sending'].includes(row.send_status) && row.first_attempt_ms <= now - RETRY_WINDOW_MS) {
    await env.DB.prepare("UPDATE email_outbox SET send_status = 'reconcile', last_error = 'Provider acceptance needs reconciliation', updated_ms = ? WHERE id = ? AND send_status IN ('uncertain','sending') AND (lease_started_ms IS NULL OR lease_started_ms <= ?)")
      .bind(now, id, now - LEASE_MS).run();
    return emailResult(await get(env, id));
  }
  if (!env.RESEND_API_KEY) return { ...emailResult(row), error: 'Email delivery is unavailable' };
  const claim = await env.DB.prepare(`UPDATE email_outbox SET send_status = 'sending', lease_started_ms = ?,
    first_attempt_ms = COALESCE(first_attempt_ms, ?), attempts = attempts + 1, last_error = NULL, updated_ms = ?
    WHERE id = ? AND attempts < 5 AND (send_status IN ('queued','failed','uncertain') OR (send_status = 'sending' AND lease_started_ms <= ?))`)
    .bind(now, now, now, id, now - LEASE_MS).run();
  if (claim.meta?.changes !== 1) return emailResult(await get(env, id));
  let state = 'uncertain', providerId = null, error = 'Provider acceptance is unknown';
  try {
    const response = await fetcher('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'idempotency-key': `outbox/${id}` }, body: row.message_json });
    const result = await response.json().catch(() => null);
    if (response.ok && typeof result?.id === 'string' && result.id.length <= 100) { state = 'accepted'; providerId = result.id; error = null; }
    else if (response.status >= 400 && response.status < 500 && response.status !== 409) { state = 'failed'; error = `Email provider rejected the request (${response.status})`; }
  } catch { /* The exact request may already have reached the provider. */ }
  // Guard against an older lease completing after another worker has reclaimed it. A storage
  // failure leaves 'sending'; the persisted provider key still protects the next retry.
  await env.DB.prepare(`UPDATE email_outbox SET send_status = ?, provider_id = COALESCE(?, provider_id),
    accepted_ms = CASE WHEN ? = 'accepted' THEN ? ELSE accepted_ms END, last_error = ?, updated_ms = ?
    WHERE id = ? AND send_status = 'sending' AND lease_started_ms = ?`)
    .bind(state, providerId, state, now, error, now, id, now).run();
  return emailResult(await get(env, id));
}
