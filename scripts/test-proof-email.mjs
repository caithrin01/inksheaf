import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { onRequest } from '../functions/api/proof-email.js';
import { hmacHex } from '../functions/lib/press-dispatch.js';
import { deliverCreatorPdf } from './lib/creator-pdf-mail.mjs';

const originalFetch = globalThis.fetch;
function setup() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${file}`, 'utf8'));
  db.exec("INSERT INTO signups (id,publication_url,email,raw_json,plan_json,email_verified_at) VALUES (1,'https://writer.substack.com','owner@example.com','{}','{}',datetime('now'))");
  db.exec(`INSERT INTO edition_versions (id,signup_id,plan_json,post_ids,body_hashes,renderer_sha,print_mode,volumes,status)
    VALUES (1,1,'{}','[1,2]','{}','fixture','bw','[{"label":"Volume I","key":"first.pdf"},{"label":"Volume II","key":"second.pdf"}]','proofed')`);
  const DB = { prepare(sql) { const stmt = db.prepare(sql); let args = []; return {
    bind(...values) { args = values; return this; }, async first() { return stmt.get(...args) || null; },
    async run() { const r = stmt.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  }; } };
  const env = { DB, INKSHEAF_ENV: 'production', RESEND_API_KEY: 'test-only', ARCHIVE_RELAY_TOKEN: 'test-only-secret' };
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); if (url !== 'https://api.resend.com/emails') throw Error('Unexpected outbound call'); return Response.json({ id: 'provider-message' }); };
  return { db, env, calls };
}
const message = { subject: 'Your complete PDF: The Writer', text: 'Volume I: https://private.example.test/first\nVolume II: https://private.example.test/second' };
async function send(c, overrides = {}) {
  const body = { version_id: 1, sig: await hmacHex(c.env.ARCHIVE_RELAY_TOKEN, 'proof-email:1'), ...message, ...overrides };
  return onRequest({ request: new Request('https://inksheaf.com/api/proof-email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env: c.env });
}
let passed = 0;
async function test(name, run) { const c = setup(); try { await run(c); passed++; console.log('PASS', name); } finally { c.db.close(); globalThis.fetch = originalFetch; } }
await test('initial delivery and replay preserve complete multi-volume links and saved recipient', async c => {
  assert.equal((await send(c, { to: 'attacker@example.com' })).status, 200);
  const sent = JSON.parse(c.calls[0].options.body); assert.deepEqual(sent.to, ['owner@example.com']); assert.equal(sent.text, message.text);
  assert.equal((await send(c, { text: 'regenerated links should not replace the original' })).status, 200);
  assert.equal(c.calls.length, 1); assert.equal(c.db.prepare('SELECT count(*) n FROM edition_versions').get().n, 1);
});
await test('private PDF delivery requires no ownership click', async c => {
  c.db.exec('UPDATE signups SET email_verified_at=NULL');
  assert.equal((await send(c)).status, 200); assert.equal(c.calls.length, 1);
  assert.equal(c.db.prepare('SELECT email_verified_at FROM signups').get().email_verified_at, null);
});
await test('another edition cannot be accessed with this signature', async c => {
  assert.equal((await send(c, { version_id: 2 })).status, 403); assert.equal(c.calls.length, 0);
});
await test('a newer edition or superseded proof cannot send an old ready email', async c => {
  c.db.exec("UPDATE edition_versions SET status='superseded'");
  assert.equal((await send(c)).status, 409);
  c.db.exec("UPDATE edition_versions SET status='proofed'");
  c.db.exec("INSERT INTO edition_versions (id,signup_id,plan_json,post_ids,body_hashes,renderer_sha,print_mode,volumes) SELECT 2,signup_id,plan_json,post_ids,body_hashes,renderer_sha,print_mode,volumes FROM edition_versions WHERE id=1");
  assert.equal((await send(c)).status, 409); assert.equal(c.calls.length, 0);
});
await test('email rejection leaves the ready edition intact and retry sends only the saved message', async c => {
  globalThis.fetch = async () => Response.json({}, { status: 429 });
  const failed = await send(c); assert.equal(failed.status, 202); assert.equal((await failed.json()).delivery.accepted, false);
  assert.equal(c.db.prepare('SELECT status FROM edition_versions').get().status, 'proofed');
  globalThis.fetch = async (url, options) => { c.calls.push({ url, options }); return Response.json({ id: 'recovered' }); };
  assert.equal((await send(c)).status, 200); assert.equal(c.calls.length, 1);
});
await test('an outage is reported rather than an empty successful delivery', async c => {
  c.env.DB.prepare = () => { throw Error('database unavailable'); };
  const response = await send(c); assert.equal(response.status, 503); assert.equal((await response.json()).ok, false); assert.equal(c.calls.length, 0);
});
await test('GET does not register or send an email', async c => {
  const response = await onRequest({ request: new Request('https://inksheaf.com/api/proof-email'), env: c.env });
  assert.equal(response.status, 405); assert.equal(c.calls.length, 0); assert.equal(c.db.prepare('SELECT count(*) n FROM email_outbox').get().n, 0);
});
await test('a changed reservation recipient requires review rather than redirecting a saved message', async c => {
  delete c.env.RESEND_API_KEY; assert.equal((await send(c)).status, 202);
  c.db.exec("UPDATE signups SET email='different@example.com'");
  assert.equal((await send(c)).status, 409); assert.equal(c.calls.length, 0);
});
await test('press callback accurately distinguishes pending email and transport failure', async c => {
  const args = { site: 'https://inksheaf.com', secret: c.env.ARCHIVE_RELAY_TOKEN, versionId: 1, ...message };
  const result = await deliverCreatorPdf(args, { fetcher: async (url, options) => {
    delete c.env.RESEND_API_KEY;
    return onRequest({ request: new Request(url, options), env: c.env });
  } });
  assert.equal(result.accepted, false); assert.equal(result.status, 'queued');
  await assert.rejects(deliverCreatorPdf(args, { fetcher: async () => Response.json({}, { status: 503 }) }), /could not be confirmed/);
  assert.equal(c.db.prepare('SELECT status FROM edition_versions').get().status, 'proofed');
});
await test('operator status is read-only and retry cannot invent a missing message', async c => {
  const response = await send(c, { action: 'status' });
  assert.equal(response.status, 200); assert.equal((await response.json()).delivery.status, 'missing');
  assert.equal((await send(c, { action: 'retry' })).status, 409);
  assert.equal(c.db.prepare('SELECT count(*) n FROM email_outbox').get().n, 0); assert.equal(c.calls.length, 0);
});
await test('operator retry recovers the saved message without providing content or recipient', async c => {
  delete c.env.RESEND_API_KEY; await send(c);
  c.env.RESEND_API_KEY = 'test-only';
  const response = await send(c, { action: 'retry', text: undefined, subject: undefined });
  assert.equal(response.status, 200); assert.equal(c.calls.length, 1);
  assert.equal(JSON.parse(c.calls[0].options.body).text, message.text);
});
await test('a pending revision blocks an old ready email before the replacement is rendered', async c => {
  c.db.exec(`UPDATE signups SET plan_json='{"changed_at":"now"}'`);
  assert.equal((await send(c)).status, 409); assert.equal(c.calls.length, 0);
});
await test('a revision racing the send claim cannot emit an old ready message', async c => {
  const prepare = c.env.DB.prepare;
  c.env.DB.prepare = sql => {
    if (sql.startsWith("UPDATE email_outbox SET send_status = 'sending'")) c.db.exec(`UPDATE signups SET plan_json='{"changed_at":"now"}'`);
    return prepare(sql);
  };
  const result = await (await send(c)).json(); assert.equal(result.delivery.accepted, false); assert.equal(c.calls.length, 0);
});
console.log(`${passed} creator proof-email checks passed`);
