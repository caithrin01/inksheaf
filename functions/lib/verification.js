import { startPrivatePdf } from './private-pdf.js';
import { recordVerifiedFunnel, scheduleFunnelAlert } from './funnel.js';

export async function confirmReservation(env, signup, { token, waitUntil } = {}) {
  if (token) await env.DB.prepare("UPDATE email_verifications SET verified_at = COALESCE(verified_at, datetime('now')) WHERE token = ?").bind(token).run();
  await env.DB.prepare("UPDATE signups SET email_verified_at = COALESCE(email_verified_at, datetime('now')) WHERE id = ?").bind(signup.id).run();
  const { press: state } = await startPrivatePdf(env, signup);
  const tracked = await recordVerifiedFunnel(env, signup.id);
  if (tracked.alert) scheduleFunnelAlert(waitUntil, env, { ...tracked, stage: 'verified', press: state });
  return { ok: true, verified: true, press: state,
    heading: state === 'dispatched' ? 'Confirmed. Your PDF is being prepared.' : 'Confirmed. Your PDF is queued.',
    message: state === 'dispatched' ? `We will email the complete PDF to ${signup.email} when it is ready. Nothing has been published or ordered.` : 'Your ownership is confirmed. We could not confirm the start of the PDF run yet; your request is saved for follow-up.' };
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
