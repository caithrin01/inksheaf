// When a book stops: the operator learns at once with everything needed to act, and the
// creator is told once, plainly, that a person is finishing it. Before this, a held book
// told no one; the owner found failures through GitHub's own emails (2026-10-09).
import { prepareOutboundEmail } from './runtime.js';
import { hmacHex } from './press-dispatch.js';

const SITE = 'https://inksheaf.com';
const send = async (env, message, fetcher) => {
  let prepared;
  try { prepared = prepareOutboundEmail(env, message); } catch (e) { return { sent: false, reason: String(e?.message || e) }; }
  const r = await fetcher('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(prepared) }).catch(() => null);
  return { sent: Boolean(r?.ok), status: r?.status || 0 };
};

export async function editionLink(env, signupId) {
  return env.ARCHIVE_RELAY_TOKEN ? `${SITE}/edition?id=${signupId}&sig=${await hmacHex(env.ARCHIVE_RELAY_TOKEN, `edition:${signupId}`)}` : SITE;
}

export async function alertOperatorHeld(env, { signupId, message = '', run = null }, { fetcher = fetch } = {}) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'no email key' };
  const to = String(env.OPERATOR_EMAIL || env.FUNNEL_ALERT_EMAIL || 'caithrin@caithrin.com').trim();
  const row = await env.DB.prepare('SELECT publication_url, email FROM signups WHERE id = ?').bind(signupId).first().catch(() => null);
  const host = String(row?.publication_url || 'unknown').replace(/^https?:\/\//, '');
  const lines = [
    `A book stopped before it was delivered.`, '',
    `Publication: ${host}`, `Signup: #${signupId}`, `Writer: ${row?.email || 'unknown'}`, `Reason: ${String(message || 'not reported').slice(0, 500)}`,
    run ? `Run: https://github.com/caithrin01/inksheaf/actions/runs/${run}` : 'Run: not reported', `Edition page: ${await editionLink(env, signupId)}`, '',
    'To re-run after a fix: gh run rerun ' + (run || '<run id>') + ' --repo caithrin01/inksheaf',
    'Creator notification is tracked separately; operator review runs do not notify the writer. Runbook: 05-Projects/Substack Magazine/failure-modes-runbook.md',
  ];
  return send(env, { from: 'Inksheaf <press@inksheaf.com>', to: [to], reply_to: 'caithrin@caithrin.com', subject: `Book held: ${host} (#${signupId})`, text: lines.join('\n') }, fetcher);
}

export async function tellCreatorHeld(env, { signupId }, { fetcher = fetch } = {}) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'no email key' };
  // Once per signup: a second hold never sends a second apology.
  const told = await env.DB.prepare("SELECT 1 FROM events WHERE event = 'creator_held_notice' AND session = ? LIMIT 1").bind(String(signupId)).first().catch(() => null);
  if (told) return { sent: false, reason: 'already told' };
  const row = await env.DB.prepare('SELECT publication_url, email FROM signups WHERE id = ?').bind(signupId).first().catch(() => null);
  if (!row?.email) return { sent: false, reason: 'no writer email' };
  const text = [
    'Your book stopped before it was finished, and a person is now finishing it.',
    'Your writing and your choices are saved, so there is nothing you need to do. We will email you when it is ready.', '',
    `You can follow it here: ${await editionLink(env, signupId)}`, '',
    'Reply to this email and a person answers.', '', 'Inksheaf',
  ].join('\n');
  const result = await send(env, { from: 'Inksheaf <press@inksheaf.com>', to: [row.email], reply_to: 'caithrin@caithrin.com', subject: 'Your Inksheaf book needs a person to finish it', text }, fetcher);
  if (result.sent) await env.DB.prepare("INSERT INTO events (session, event) VALUES (?, 'creator_held_notice')").bind(String(signupId)).run().catch(() => {});
  return result;
}

// A book well past its planned time: the writer hears once that it is taking longer, not silence.
export async function tellCreatorDelayed(env, { signupId }, { fetcher = fetch } = {}) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'no email key' };
  const told = await env.DB.prepare("SELECT 1 FROM events WHERE event IN ('creator_delay_notice','creator_held_notice') AND session = ? LIMIT 1").bind(String(signupId)).first().catch(() => null);
  if (told) return { sent: false, reason: 'already told' };
  const row = await env.DB.prepare('SELECT email FROM signups WHERE id = ?').bind(signupId).first().catch(() => null);
  if (!row?.email) return { sent: false, reason: 'no writer email' };
  const text = [
    'Your book is taking longer than usual to make. A person has been told and is looking at it now.',
    'Your writing and your choices are saved, so there is nothing you need to do. We will email you when it is ready.', '',
    `You can follow it here: ${await editionLink(env, signupId)}`, '',
    'Reply to this email and a person answers.', '', 'Inksheaf',
  ].join('\n');
  const result = await send(env, { from: 'Inksheaf <press@inksheaf.com>', to: [row.email], reply_to: 'caithrin@caithrin.com', subject: 'Your Inksheaf book is taking longer than usual', text }, fetcher);
  if (result.sent) await env.DB.prepare("INSERT INTO events (session, event) VALUES (?, 'creator_delay_notice')").bind(String(signupId)).run().catch(() => {});
  return result;
}
