#!/usr/bin/env node
// Dependency health for the live product, run by .github/workflows/health.yml. Every probe is
// read-only or a deliberately unsigned request that a healthy service refuses. Each line names
// a failure we have actually had: an out-of-date proof store (404 on /checkpoint, 2026-10-06),
// an OpenRouter key at its own cap (2026-10-05), Substack refusing runners (relay, 2026-09-26),
// and runs that never started (the watchdog). Any failure exits 1 and emails the operator.
import { createHmac } from 'node:crypto';

const env = process.env, results = [];
const probe = async (name, fn) => {
  try { const detail = await fn(); results.push({ name, ok: true, detail }); }
  catch (e) { results.push({ name, ok: false, detail: String(e.message || e).slice(0, 240) }); }
};
const get = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
const expect = (cond, msg) => { if (!cond) throw Error(msg); };
const sign = (m) => createHmac('sha256', env.ARCHIVE_RELAY_TOKEN).update(m).digest('hex');
const STORE = 'https://caithrin--inksheaf-proof-store-web.modal.run', RELAY = 'https://caithrin--inksheaf-archive-relay-archive.modal.run';

await probe('site serves the homepage and the press release record', async () => {
  const home = await get('https://inksheaf.com/'); expect(home.status === 200, `homepage ${home.status}`);
  const rel = await (await get('https://inksheaf.com/inksheaf-press.json')).json(); expect(/^[a-f0-9]{40}$/.test(rel.sha || ''), 'no release sha');
  return `release ${rel.sha.slice(0, 7)}`;
});
await probe('proof store has both routes the press uses', async () => {
  const proof = await get(`${STORE}/proof?key=x&exp=1&sig=x`), checkpoint = await get(`${STORE}/checkpoint?key=x&sig=x`);
  // A healthy store refuses an unsigned request; 404 means the route is missing (an old deploy).
  expect(proof.status !== 404 && proof.status < 500, `/proof ${proof.status}`); expect(checkpoint.status !== 404 && checkpoint.status < 500, `/checkpoint ${checkpoint.status}`);
  return `/proof ${proof.status}, /checkpoint ${checkpoint.status}`;
});
await probe('relay answers a signed archive page', async () => {
  expect(env.ARCHIVE_RELAY_TOKEN, 'no relay token in this environment');
  const host = 'www.caithrin.com', r = await get(`${RELAY}?${new URLSearchParams({ host, offset: '0', sig: sign(`${host}:0`) })}`, { headers: { accept: 'application/json' } });
  expect(r.ok, `relay ${r.status}`); const rows = await r.json(); expect(Array.isArray(rows) && rows.length > 0, 'relay returned no posts');
  return `${rows.length} posts`;
});
await probe('OpenRouter key and credit have room for books', async () => {
  expect(env.OPENROUTER_API_KEY, 'no OpenRouter key in this environment');
  const auth = { headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}` } };
  const key = (await (await get('https://openrouter.ai/api/v1/key', auth)).json()).data || {};
  const credit = (await (await get('https://openrouter.ai/api/v1/credits', auth)).json()).data || {};
  const left = key.limit == null ? Infinity : Number(key.limit_remaining), balance = Number(credit.total_credits) - Number(credit.total_usage);
  expect(left >= 20, `key has $${left.toFixed(2)} left of its $${key.limit} limit`); expect(balance >= 20, `account credit is $${balance.toFixed(2)}`);
  return `key $${Number.isFinite(left) ? left.toFixed(2) : 'unlimited'} left, credit $${balance.toFixed(2)}`;
});
await probe('Resend can send from inksheaf.com', async () => {
  expect(env.RESEND_API_KEY, 'no Resend key in this environment');
  const answer = await (await get('https://api.resend.com/domains', { headers: { authorization: `Bearer ${env.RESEND_API_KEY}` } })).json();
  // The production key may send only; its refusal to list domains still proves it is a live key.
  if (answer.name === 'restricted_api_key') return 'send-only key recognised';
  const d = (answer.data || []).find(x => x.name === 'inksheaf.com'); expect(d, `inksheaf.com is not a Resend domain (${answer.message || 'no domains'})`); expect(d.status === 'verified', `inksheaf.com is ${d.status}`);
  return 'verified';
});
await probe('Lulu accepts our credentials', async () => {
  expect(env.LULU_CLIENT_KEY && env.LULU_CLIENT_SECRET, 'no Lulu credentials in this environment');
  const r = await get('https://api.lulu.com/auth/realms/glasstree/protocol/openid-connect/token', { method: 'POST',
    headers: { authorization: 'Basic ' + Buffer.from(`${env.LULU_CLIENT_KEY}:${env.LULU_CLIENT_SECRET}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials' });
  expect(r.ok, `Lulu token ${r.status}`); return 'token issued';
});
await probe('no book is stuck', async () => {
  const b = Math.floor(Date.now() / 300000), r = await get(`https://inksheaf.com/api/watchdog?b=${b}&sig=${sign(`watchdog:${b}`)}`);
  expect(r.ok, `watchdog ${r.status}`); const { stuck } = await r.json();
  expect(!stuck.length, `${stuck.length} stuck: ${stuck.map(s => `#${s.signup_id} ${s.publication} (${s.status}, ${s.minutes} min)`).join('; ')}`);
  return 'none';
});

const failed = results.filter(r => !r.ok);
for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}: ${r.detail}`);
if (failed.length && env.RESEND_API_KEY && env.HEALTH_ALERT_TO) {
  await get('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: 'Inksheaf <press@inksheaf.com>', to: [env.HEALTH_ALERT_TO], subject: `Inksheaf health: ${failed.length} check${failed.length === 1 ? '' : 's'} failing`,
      text: failed.map(r => `${r.name}: ${r.detail}`).join('\n') + `\n\nRunbook: 05-Projects/Substack Magazine/failure-modes-runbook.md\nRun: ${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY || 'caithrin01/inksheaf'}/actions/runs/${env.GITHUB_RUN_ID || ''}` }) }).catch(() => {});
}
process.exit(failed.length ? 1 : 0);
