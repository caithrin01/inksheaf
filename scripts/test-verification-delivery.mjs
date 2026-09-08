// Exercise production handlers against real SQLite, with all network effects stubbed.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { onRequest as signup } from '../functions/api/signup.js';
import { onRequest as verify, sendVerification } from '../functions/api/verify.js';
import { onRequest as about } from '../functions/api/verify-about.js';

const originalFetch = globalThis.fetch;
const request = (path, body) => new Request(`https://inksheaf.com${path}`, body == null ? {} : {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const fixture = (extra = {}) => ({ publication_url: 'https://writer.substack.com', email: 'owner@example.com',
  plan_json: JSON.stringify({ cadence: 'annual', volumes: [{ label: '2026', post_ids: [1, 2] }] }),
  reservation_key: crypto.randomUUID(), ...extra });
function setup() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${file}`, 'utf8'));
  const DB = { prepare(sql) { const stmt = db.prepare(sql); let args = []; return {
    bind(...values) { args = values; return this; },
    async first() { return stmt.get(...args) || null; },
    async all() { return { results: stmt.all(...args) }; },
    async run() { const r = stmt.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  }; } };
  const env = { DB, INKSHEAF_ENV: 'production', RESEND_API_KEY: 'test-only', GITHUB_DISPATCH_TOKEN: 'test-only' };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === 'https://api.resend.com/emails') return Response.json({ id: `mail-${calls.length}` });
    if (String(url).startsWith('https://api.github.com/repos/')) return new Response(null, { status: 204 });
    throw new Error('Unexpected network request');
  };
  return { db, env, calls };
}
const mailCalls = calls => calls.filter(c => c.url === 'https://api.resend.com/emails');
const dispatchCalls = calls => calls.filter(c => c.url.startsWith('https://api.github.com/'));
async function reserve(env, body = fixture()) { return signup({ request: request('/api/signup', body), env }); }
async function makeReservation(context, body = fixture()) {
  const r = await reserve(context.env, body); assert.equal(r.status, 200);
  const result = await r.json();
  const row = context.db.prepare('SELECT * FROM signups WHERE id = ?').get(result.id);
  const token = context.db.prepare('SELECT token FROM email_verifications WHERE signup_id = ? ORDER BY rowid DESC LIMIT 1').get(result.id)?.token;
  return { body, result, row, token };
}
let passed = 0;
async function test(name, run) { const c = setup(); try { await run(c); passed++; console.log('PASS', name); } finally { c.db.close(); globalThis.fetch = originalFetch; } }

await test('a new edition for a returning owner preserves the older reservation', async c => {
  const body = fixture();
  c.db.prepare("INSERT INTO signups (publication_url,email,raw_json,plan_json,dispatch_status) VALUES (?,?,'{}','old plan','done')").run(body.publication_url, body.email);
  const { result } = await makeReservation(c, body);
  assert.equal(result.id, 2); assert.equal(result.sent, true);
  assert.equal(c.db.prepare('SELECT plan_json FROM signups WHERE id=1').get().plan_json, 'old plan');
  assert.equal(mailCalls(c.calls).length, 1);
  assert.deepEqual(JSON.parse(mailCalls(c.calls)[0].options.body).to, ['writer@substack.com']);
});
await test('simultaneous retries create one reservation and one verification send', async c => {
  const body = fixture();
  const responses = await Promise.all([reserve(c.env, body), reserve(c.env, body)]);
  const values = await Promise.all(responses.map(r => r.json()));
  assert.equal(values[0].id, values[1].id);
  assert.equal(c.db.prepare('SELECT count(*) n FROM signups').get().n, 1);
  assert.equal(mailCalls(c.calls).length, 1);
  const repeat = await (await reserve(c.env, body)).json();
  assert.equal(repeat.sent, true); assert.equal(mailCalls(c.calls).length, 1);
});
await test('a reused request key cannot replace the recipient or selected edition', async c => {
  const { body } = await makeReservation(c);
  assert.equal((await reserve(c.env, { ...body, email: 'someone-else@example.com' })).status, 409);
  assert.equal((await reserve(c.env, { ...body, plan_json: '{}' })).status, 409);
  assert.equal(c.db.prepare('SELECT plan_json FROM signups').get().plan_json, body.plan_json);
});
await test('provider rejection is a saved reservation with a truthful failed-send result', async c => {
  globalThis.fetch = async () => Response.json({ message: 'private provider detail' }, { status: 500 });
  const { result, token } = await makeReservation(c);
  assert.equal(result.ok, true); assert.equal(result.sent, false); assert.ok(result.error);
  assert.equal(c.db.prepare('SELECT send_status FROM email_verifications WHERE token=?').get(token).send_status, 'failed');
  assert(!JSON.stringify(result).includes('private provider detail'));
});
await test('missing credentials cannot be reported as a sent confirmation', async c => {
  delete c.env.RESEND_API_KEY;
  const { result } = await makeReservation(c);
  assert.equal(result.sent, false); assert.equal(c.calls.length, 0);
});
await test('uncertain email acknowledgement retries the exact message and provider key', async c => {
  const seen = [];
  globalThis.fetch = async (_url, options) => { seen.push(options); if (seen.length === 1) throw Error('network lost'); return Response.json({ id: 'accepted-on-retry' }); };
  const { result, row, token } = await makeReservation(c);
  assert.equal(result.sent, false);
  const retry = await sendVerification(c.env, row, 'https://a-new-deployment.example.com', { resend: true });
  assert.equal(retry.sent, true); assert.equal(seen.length, 2);
  assert.equal(seen[0].headers['idempotency-key'], seen[1].headers['idempotency-key']);
  assert.equal(seen[0].body, seen[1].body);
  assert.equal(c.db.prepare('SELECT count(*) n FROM email_verifications').get().n, 1);
  assert.equal(c.db.prepare('SELECT provider_id FROM email_verifications WHERE token=?').get(token).provider_id, 'accepted-on-retry');
});
await test('an explicit resend after acceptance produces a new confirmation', async c => {
  const { row, token } = await makeReservation(c);
  const r = await verify({ request: request('/api/verify', { signup_id: row.id }), env: c.env });
  assert.equal((await r.json()).sent, true);
  assert.equal(mailCalls(c.calls).length, 2);
  assert.equal(c.db.prepare('SELECT count(*) n FROM email_verifications WHERE token != ?').get(token).n, 1);
});
await test('email-scanner GET makes no database changes and starts no press', async c => {
  const { token } = await makeReservation(c);
  const before = c.db.prepare('SELECT total_changes() n').get().n;
  const r = await verify({ request: request(`/api/verify?t=${token}`), env: c.env });
  assert.equal(r.status, 200); assert.match(await r.text(), /Confirm and prepare my PDF/);
  assert.equal(c.db.prepare('SELECT total_changes() n').get().n, before);
  assert.equal(dispatchCalls(c.calls).length, 0);
});
await test('concurrent confirmation and later replay dispatch exactly one press run', async c => {
  const { token, result } = await makeReservation(c);
  const submit = () => verify({ request: request('/api/verify', { t: token }), env: c.env });
  await Promise.all([submit(), submit()]); await submit();
  assert.equal(dispatchCalls(c.calls).length, 1);
  assert.equal(c.db.prepare('SELECT dispatch_status FROM signups WHERE id=?').get(result.id).dispatch_status, 'dispatched');
  assert.equal(JSON.parse(dispatchCalls(c.calls)[0].options.body).client_payload.signup_id, result.id);
});
await test('SQLite UTC expiry rejects an earlier time today and permits a later time today', async c => {
  const { token } = await makeReservation(c);
  c.db.prepare("UPDATE email_verifications SET expires_at=datetime('now','-1 hour') WHERE token=?").run(token);
  const expired = await verify({ request: request(`/api/verify?t=${token}`), env: c.env });
  assert.equal(expired.status, 410);
  c.db.prepare("UPDATE email_verifications SET expires_at=datetime('now','+1 hour') WHERE token=?").run(token);
  assert.equal((await verify({ request: request(`/api/verify?t=${token}`), env: c.env })).status, 200);
  assert.equal(dispatchCalls(c.calls).length, 0);
});
await test('invalid and missing tokens cannot confirm ownership', async c => {
  assert.equal((await verify({ request: request('/api/verify?t=bad'), env: c.env })).status, 403);
  assert.equal((await verify({ request: request('/api/verify', { t: 'a'.repeat(40) }), env: c.env })).status, 404);
  assert.equal(dispatchCalls(c.calls).length, 0);
});
await test('unknown dispatch outcome is held instead of blindly dispatching again', async c => {
  const { token } = await makeReservation(c); let attempts = 0;
  globalThis.fetch = async () => { attempts++; throw Error('connection lost after request'); };
  await verify({ request: request('/api/verify', { t: token }), env: c.env });
  await verify({ request: request('/api/verify', { t: token }), env: c.env });
  assert.equal(attempts, 1);
  assert.equal(c.db.prepare('SELECT dispatch_status FROM signups').get().dispatch_status, 'dispatch-uncertain');
});
await test('confirmed provider rejection can be retried after the dispatch problem is fixed', async c => {
  const { token } = await makeReservation(c); let attempts = 0;
  globalThis.fetch = async () => { attempts++; return new Response(null, { status: attempts === 1 ? 401 : 204 }); };
  await verify({ request: request('/api/verify', { t: token }), env: c.env });
  assert.equal(c.db.prepare('SELECT dispatch_status FROM signups').get().dispatch_status, 'queued');
  await verify({ request: request('/api/verify', { t: token }), env: c.env });
  assert.equal(attempts, 2); assert.equal(c.db.prepare('SELECT dispatch_status FROM signups').get().dispatch_status, 'dispatched');
});
await test('a verified reservation cannot resend verification or restart its press', async c => {
  const { token, result } = await makeReservation(c);
  await verify({ request: request('/api/verify', { t: token }), env: c.env });
  const r = await verify({ request: request('/api/verify', { signup_id: result.id }), env: c.env });
  assert.equal((await r.json()).verified, true); assert.equal(mailCalls(c.calls).length, 1); assert.equal(dispatchCalls(c.calls).length, 1);
});
await test('staging never emails the publication alias', async c => {
  c.env.INKSHEAF_ENV = 'staging'; c.env.STAGING_EMAIL = 'sink@example.com';
  const { token } = await makeReservation(c);
  assert.deepEqual(JSON.parse(mailCalls(c.calls)[0].options.body).to, ['sink@example.com']);
  await verify({ request: request('/api/verify', { t: token }), env: c.env });
  assert.equal(JSON.parse(dispatchCalls(c.calls)[0].options.body).event_type, 'staging-press');
});
await test('About-page verification shares the same single-dispatch claim', async c => {
  const { token, result } = await makeReservation(c);
  const code = await (await about({ request: request('/api/verify-about', { signup_id: result.id }), env: c.env })).json();
  assert.match(code.code, /^inksheaf-verify-[0-9a-f]{24}$/);
  const stub = globalThis.fetch;
  globalThis.fetch = async (url, options) => String(url).includes('writer.substack.com') ? new Response(code.code) : stub(url, options);
  await Promise.all([
    verify({ request: request('/api/verify', { t: token }), env: c.env }),
    about({ request: request('/api/verify-about', { signup_id: result.id, check: true }), env: c.env }),
  ]);
  assert.equal(dispatchCalls(c.calls).length, 1);
});
await test('expired About-page codes cannot be replaced silently during a check', async c => {
  const { result } = await makeReservation(c);
  const r = await about({ request: request('/api/verify-about', { signup_id: result.id, check: true }), env: c.env });
  assert.equal(r.status, 410); assert.equal(dispatchCalls(c.calls).length, 0);
});
await test('request retries still resume after the press updates the working plan', async c => {
  const { body, result } = await makeReservation(c);
  c.db.prepare("UPDATE signups SET plan_json='updated by renderer',email_verified_at=datetime('now'),dispatch_status='dispatched' WHERE id=?").run(result.id);
  const repeated = await reserve(c.env, body);
  assert.equal(repeated.status, 200); assert.equal((await repeated.json()).id, result.id);
  assert.equal(mailCalls(c.calls).length, 1);
});
await test('custom-domain metadata selects its matching publication alias', async c => {
  const stub = globalThis.fetch;
  globalThis.fetch = async (url, options) => String(url).startsWith('https://publication.example.com/')
    ? Response.json([{ publication_id: 42, publication: { id: 42, name: 'The publication', subdomain: 'real-writer', custom_domain: 'publication.example.com' } }]) : stub(url, options);
  const { result } = await makeReservation(c, fixture({ publication_url: 'https://publication.example.com' }));
  assert.equal(result.sent_to, 'real-writer@substack.com'); assert.equal(result.sent, true);
});
await test('an unrelated author membership never selects the wrong verification inbox', async c => {
  globalThis.fetch = async url => String(url).includes('/api/v1/archive')
    ? Response.json([{ publication_id: 42, publishedBylines: [{ publicationUsers: [{ publication: { id: 99, name: 'Other book', subdomain: 'wrong-author', custom_domain: 'wrong.example.com' } }] }] }]) : new Response('<html></html>');
  const { result } = await makeReservation(c, fixture({ publication_url: 'https://publication.example.com' }));
  assert.equal(result.sent, false); assert.equal(result.sent_to, undefined);
  assert.equal(c.db.prepare('SELECT count(*) n FROM email_verifications').get().n, 0);
});
await test('database-read failure is unavailable, never an invalid-token verdict', async c => {
  const env = { ...c.env, DB: { prepare() { throw Error('database unavailable'); } } };
  const r = await verify({ request: request(`/api/verify?t=${'a'.repeat(40)}`), env });
  assert.equal(r.status, 503); assert.match(await r.text(), /temporarily unavailable/);
});
await test('stored ambiguous mail cannot cross from production into a staging inbox', async c => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('lost acknowledgement'); };
  const { row } = await makeReservation(c);
  const retry = await sendVerification({ ...c.env, INKSHEAF_ENV:'staging', STAGING_EMAIL:'sink@example.com' }, row, 'https://stage.example.com', { resend:true });
  assert.equal(retry.sent, false); assert.equal(calls, 1);
});
console.log(`${passed} verification delivery checks passed`);
