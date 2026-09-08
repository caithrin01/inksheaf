import { dispatchPress } from './press-dispatch.js';
import { recordVerifiedFunnel, scheduleFunnelAlert } from './funnel.js';

export async function confirmReservation(env, signup, { token, waitUntil } = {}) {
  if (token) await env.DB.prepare("UPDATE email_verifications SET verified_at = COALESCE(verified_at, datetime('now')) WHERE token = ?").bind(token).run();
  await env.DB.prepare("UPDATE signups SET email_verified_at = COALESCE(email_verified_at, datetime('now')) WHERE id = ?").bind(signup.id).run();
  // Only one caller owns dispatch. Unknown provider outcomes require reconciliation.
  const claim = await env.DB.prepare("UPDATE signups SET dispatch_status = 'dispatching' WHERE id = ? AND (dispatch_status IS NULL OR dispatch_status IN ('awaiting-verification', 'queued', 'verification-failed'))").bind(signup.id).run();
  if (claim.meta?.changes !== 1) {
    const current = await env.DB.prepare('SELECT dispatch_status FROM signups WHERE id = ?').bind(signup.id).first();
    const checking = ['dispatching', 'dispatch-uncertain'].includes(current?.dispatch_status);
    return { ok: true, verified: true, press: current?.dispatch_status,
      heading: checking ? 'Your publication is confirmed.' : 'Already confirmed.',
      message: checking ? 'We are checking the start of your PDF run. There is no need to confirm again.' : 'Your request is recorded. We will email the PDF when it is ready.' };
  }
  const result = await dispatchPress(env, { event: 'press', signup_id: signup.id,
    publication_url: signup.publication_url, email: signup.email, plan_json: signup.plan_json });
  const state = result.ok ? 'dispatched' : (result.status || result.reason === 'no dispatch token') ? 'queued' : 'dispatch-uncertain';
  await env.DB.prepare('UPDATE signups SET dispatch_status = ? WHERE id = ?').bind(state, signup.id).run();
  await env.DB.prepare("INSERT INTO press (signup_id, status, detail, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(signup_id) DO UPDATE SET status = excluded.status, detail = excluded.detail, updated_at = datetime('now')")
    .bind(signup.id, result.ok ? 'building' : 'queued', JSON.stringify({ message: result.ok ? 'press started after verification' : state === 'dispatch-uncertain' ? 'dispatch outcome needs reconciliation' : 'press dispatch is queued' })).run();
  const tracked = await recordVerifiedFunnel(env, signup.id);
  if (tracked.alert) scheduleFunnelAlert(waitUntil, env, { ...tracked, stage: 'verified', press: state });
  return { ok: true, verified: true, press: state,
    heading: result.ok ? 'Confirmed. Your PDF is being prepared.' : 'Confirmed. Your PDF is queued.',
    message: result.ok ? `We will email the complete PDF to ${signup.email} when it is ready. Nothing has been published or ordered.` : 'Your ownership is confirmed. We could not confirm the start of the PDF run yet; your request is saved for follow-up.' };
}

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function confirmationPage(signup, token) {
  return verificationPage('Confirm your PDF request.', 'Confirm that you own this publication and asked us to prepare its private PDF.', 200,
    `<dl><dt>Publication</dt><dd>${escape(new URL(signup.publication_url).hostname)}</dd><dt>Send the PDF to</dt><dd>${escape(signup.email)}</dd></dl>
<form method="post" action="/api/verify"><input type="hidden" name="t" value="${escape(token)}"><button type="submit">Confirm and prepare my PDF</button></form><p class="note">This prepares a private PDF. It does not publish or order a book.</p>`);
}
export function verificationPage(heading, message, status = 200, extra = '') {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(heading)} — Inksheaf</title>
<style>@font-face{font-family:Inter;src:url('/fonts/inter.woff2') format('woff2');font-display:swap}@font-face{font-family:SourceSerif;src:url('/fonts/source-serif.woff2') format('woff2');font-display:swap}*{box-sizing:border-box}body{font:18px/1.6 SourceSerif,Georgia,serif;background:#f7f3e9;color:#211c15;max-width:38rem;margin:10vh auto;padding:0 1.4rem;overflow-wrap:anywhere}h1{font-size:clamp(1.9rem,6vw,2.6rem);line-height:1.15;font-weight:500;margin-top:3rem}a{color:inherit}img{display:block;width:142px;height:auto}dl{margin:1.7rem 0 2rem}dt{font:500 12px/1.5 Inter,sans-serif;margin-top:1rem}dd{margin:.25rem 0 0;font-size:1.2rem}button{max-width:100%;font:500 14px/1.4 Inter,sans-serif;padding:1rem 1.3rem;background:#211c15;color:#fff;border:0;border-radius:3px;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #211c15;outline-offset:4px}.help,.note{font:13px/1.7 Inter,sans-serif}.help{margin-top:2.5rem}</style>
<main><a href="/" aria-label="Inksheaf home"><img src="/brand/wordmark.svg" alt="Inksheaf" width="142" height="40"></a><h1>${escape(heading)}</h1><p>${escape(message)}</p>${extra}<p class="help"><a href="/">Return to Inksheaf</a> · <a href="mailto:caithrin@caithrin.com">Get help</a></p></main></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
