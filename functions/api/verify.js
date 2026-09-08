// A link opens a read-only confirmation page; an explicit POST starts the press.
import { hmacHex } from '../lib/press-dispatch.js';
import { spend, LIMITS } from '../lib/quota.js';
import { prepareOutboundEmail, runtimeMode } from '../lib/runtime.js';
import { parseHost, readLimitedText } from './preview.js';
import { publicationFromArchive, publicationFromHomepage } from '../lib/publication-identity.js';
import { confirmReservation, confirmationPage, verificationPage } from '../lib/verification.js';

export async function onRequest({ request, env, waitUntil }) {
  const url = new URL(request.url);
  if (!['GET', 'POST'].includes(request.method)) return json({ ok: false, error: 'method not allowed' }, 405);
  let body = {};
  if (request.method === 'POST') {
    try {
      body = request.headers.get('content-type')?.includes('application/json')
        ? await request.json() : Object.fromEntries(await request.formData());
    } catch { return json({ ok: false, error: 'invalid request' }, 400); }
  }
  const token = request.method === 'GET' ? url.searchParams.get('t') : body.t;
  if (request.method === 'GET' || token != null) {
    if (!/^[0-9a-f]{40}$/.test(String(token || '')))
      return verificationPage('That confirmation link is not valid.', 'Open the link from your latest confirmation email.', 403);
    let row;
    try { row = await env.DB.prepare('SELECT * FROM email_verifications WHERE token = ?').bind(token).first(); }
    catch { return verificationPage('Confirmation is temporarily unavailable.', 'Your link has not been used. Please try again shortly.', 503); }
    if (!row) return verificationPage('That confirmation link is not valid.', 'Request another confirmation from Inksheaf.', 404);
    if (!validExpiry(row.expires_at)) return verificationPage('That confirmation link has expired.', 'Return to Inksheaf and request another confirmation for your edition.', 410);
    const signup = await env.DB.prepare('SELECT * FROM signups WHERE id = ?').bind(row.signup_id).first();
    if (!signup) return verificationPage('We could not find that reservation.', 'Write to caithrin@caithrin.com for help.', 404);
    if (request.method === 'GET') return confirmationPage(signup, token);
    const result = await confirmReservation(env, signup, { token, waitUntil });
    return verificationPage(result.heading, result.message, result.status || 200);
  }
  const id = Number(body.signup_id);
  if (!Number.isSafeInteger(id) || id < 1) return json({ ok: false, error: 'signup_id' }, 400);
  const signup = await env.DB.prepare('SELECT * FROM signups WHERE id = ?').bind(id).first();
  if (!signup) return json({ ok: false, error: 'not found' }, 404);
  if (signup.email_verified_at) return json({ ok: true, verified: true, press: signup.dispatch_status || 'queued', sent: false });
  const result = await sendVerification(env, signup, url.origin, { resend: true });
  return json(result, result.ok ? 200 : result.status || 503);
}

export async function verificationState(env, id) {
  const row = await env.DB.prepare("SELECT email, send_status, sent_at FROM email_verifications WHERE signup_id = ? AND email != 'about-page' AND datetime(expires_at) > datetime('now') ORDER BY created_at DESC, rowid DESC LIMIT 1").bind(id).first();
  return { sent: row?.send_status === 'accepted', sent_to: row?.email || null,
    verification_status: row?.send_status || 'pending', fallback: 'about-code' };
}

// Ambiguous sends reuse the same token and provider idempotency key. An explicit
// resend after acceptance makes a new message; replaying a reservation does not.
export async function sendVerification(env, signup, origin, { resend = false } = {}) {
  const host = parseHost(signup.publication_url || '');
  if (!host) return { ok: false, sent: false, status: 422, error: 'unsupported publication address' };
  const quota = await spend(env, `verify:${host}`, LIMITS.verify_host);
  if (!quota.ok) return { ok: false, sent: false, status: 429, error: 'Too many confirmations for this publication this hour. Please try later.', fallback: 'about-code' };
  let previous = await env.DB.prepare("SELECT * FROM email_verifications WHERE signup_id = ? AND email != 'about-page' AND datetime(expires_at) > datetime('now') ORDER BY created_at DESC, rowid DESC LIMIT 1").bind(signup.id).first();
  if (previous?.send_status === 'accepted' && !resend)
    return { ok: true, sent: true, sent_to: previous.email, verification_status: 'accepted', fallback: 'about-code' };
  const age = previous ? Date.now() - utcTime(previous.created_at) : Infinity;
  if (previous?.send_status === 'accepted' || age >= 23 * 3600_000) previous = null;
  const subdomain = previous ? previous.email.split('@')[0] : await subdomainOf(host, env);
  if (!subdomain) return { ok: false, sent: false, status: 422, error: 'We could not find your publication’s Substack email address. Use the About-page option below.', fallback: 'about-code' };
  const to = `${subdomain}@substack.com`;
  const token = previous?.token || randomToken();
  if (!previous) await env.DB.prepare("INSERT INTO email_verifications (token, email, signup_id, expires_at) VALUES (?, ?, ?, datetime('now', '+2 days'))").bind(token, to, signup.id).run();
  const link = `${origin}/api/verify?t=${token}`;
  let message;
  try {
    if (!env.RESEND_API_KEY) throw new Error('Email unavailable');
    if (previous?.message_json) {
      if (previous.send_mode !== runtimeMode(env)) throw new Error('Email environment changed');
      message = JSON.parse(previous.message_json);
      const guarded = prepareOutboundEmail(env, message);
      if (JSON.stringify(guarded.to) !== JSON.stringify(message.to)) throw new Error('Email destination changed');
    } else message = prepareOutboundEmail(env, { from: 'Inksheaf <press@inksheaf.com>', to: [to], reply_to: 'caithrin@caithrin.com',
      subject: `Confirm your Inksheaf print run for ${host.replace(/^www\./, '')}`,
      text: `Someone requested a private PDF of ${host.replace(/^www\./, '')} for ${signup.email}.\n\nIf you own this publication and made that request, open this link and confirm:\n${link}\n\nIf you did not request this, ignore this email. Opening the link alone does not start a run. Confirming prepares a private PDF; it does not publish a listing or order a book.\n\nThis confirmation was sent to your publication's Substack address.\n\nInksheaf` });
  } catch {
    await env.DB.prepare("UPDATE email_verifications SET send_status = 'failed', send_error = 'email unavailable' WHERE token = ?").bind(token).run();
    return { ok: false, sent: false, sent_to: to, status: 503, error: 'Email delivery is unavailable. Please try again shortly or use the About-page option.', fallback: 'about-code' };
  }
  const claim = await env.DB.prepare("UPDATE email_verifications SET send_status = 'sending', send_started_at = datetime('now'), send_error = NULL, message_json = COALESCE(message_json, ?), send_mode = COALESCE(send_mode, ?) WHERE token = ? AND send_status != 'accepted' AND (send_status != 'sending' OR send_started_at < datetime('now', '-60 seconds'))").bind(JSON.stringify(message), runtimeMode(env), token).run();
  if (claim.meta?.changes !== 1) return { ok: true, sent: false, sent_to: to, verification_status: 'sending', fallback: 'about-code' };
  try {
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json', 'idempotency-key': `verification/${token}` }, body: JSON.stringify(message) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id) {
      await env.DB.prepare("UPDATE email_verifications SET send_status = 'failed', send_error = ? WHERE token = ?").bind(`provider ${response.status}`, token).run();
      return { ok: false, sent: false, sent_to: to, status: 503, error: 'We could not send your confirmation. Please retry or use the About-page option.', fallback: 'about-code' };
    }
    await env.DB.prepare("UPDATE email_verifications SET send_status = 'accepted', provider_id = ?, sent_at = datetime('now'), send_error = NULL WHERE token = ?").bind(data.id, token).run();
    return { ok: true, sent: true, sent_to: to, verification_status: 'accepted', fallback: 'about-code' };
  } catch {
    await env.DB.prepare("UPDATE email_verifications SET send_status = 'uncertain', send_error = 'send outcome unknown' WHERE token = ?").bind(token).run();
    return { ok: false, sent: false, sent_to: to, status: 503, error: 'We could not confirm that the email was sent. Check your inbox, or retry here.', fallback: 'about-code' };
  }
}

async function subdomainOf(host, env) {
  if (/^[a-z0-9][a-z0-9-]*\.substack\.com$/.test(host)) return host.split('.')[0];
  const valid = pub => /^[a-z0-9][a-z0-9-]*$/.test(pub?.subdomain || '') ? pub.subdomain.toLowerCase() : null;
  try {
    const response = await fetch(`https://${host}/api/v1/archive?sort=new&limit=3`, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
    if (response.ok) {
      const posts = JSON.parse(await readLimitedText(response));
      const sub = valid(publicationFromArchive(Array.isArray(posts) ? posts : [], host));
      if (sub) return sub;
    }
  } catch { /* Try the publication homepage next. */ }
  try {
    const response = await fetch(`https://${host}/`, { redirect: 'manual', signal: AbortSignal.timeout(4000) });
    if (response.ok) {
      const sub = valid(publicationFromHomepage(await readLimitedText(response), host));
      if (sub) return sub;
    }
  } catch { /* Try the existing authenticated public archive relay. */ }
  if (env.ARCHIVE_RELAY_TOKEN) try {
    const sig = await hmacHex(env.ARCHIVE_RELAY_TOKEN, `${host}:0`);
    const response = await fetch(`https://caithrin--inksheaf-archive-relay-archive.modal.run?host=${encodeURIComponent(host)}&offset=0&sig=${sig}`, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const posts = JSON.parse(await readLimitedText(response));
      return valid(publicationFromArchive(Array.isArray(posts) ? posts : [], host));
    }
  } catch { /* The visible ownership fallback remains available. */ }
  return null;
}
const utcTime = value => Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value || '') ? value : `${String(value || '').replace(' ', 'T')}Z`);
const validExpiry = value => Number.isFinite(utcTime(value)) && utcTime(value) > Date.now();
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(20))].map(x => x.toString(16).padStart(2, '0')).join('');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
