import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { enqueueEmail, sendQueuedEmail } from '../functions/lib/email-outbox.js';

function setup() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${file}`, 'utf8'));
  const DB = { prepare(sql) { const stmt = db.prepare(sql); let args = []; return {
    bind(...values) { args = values; return this; }, async first() { return stmt.get(...args) || null; },
    async run() { const r = stmt.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  }; } };
  const env = { DB, INKSHEAF_ENV: 'production', RESEND_API_KEY: 'test-only' };
  const calls = [];
  const fetcher = async (url, options) => { calls.push({ url, options }); return Response.json({ id: 'provider-message' }); };
  return { db, env, calls, fetcher, now: 1_800_000_000_000 };
}
const intent = (overrides = {}) => ({ operationKey: 'proof-ready/1/initial', versionId: 1, kind: 'proof-ready',
  recipient: 'owner@example.com', message: { subject: 'Your complete PDF', text: 'Open your private edition: https://example.test/private' }, ...overrides });
let passed = 0;
async function test(name, run) { const c = setup(); try { await run(c); passed++; console.log('PASS', name); } finally { c.db.close(); } }
const queue = c => enqueueEmail(c.env, intent(), { now: c.now });

await test('concurrent registration and send create one durable operation and one request', async c => {
  const [a, b] = await Promise.all([queue(c), queue(c)]); assert.equal(a.id, b.id);
  const options = { now: c.now, fetcher: c.fetcher };
  await Promise.all([sendQueuedEmail(c.env, a.id, options), sendQueuedEmail(c.env, b.id, options)]);
  assert.equal(c.calls.length, 1); assert.equal(c.db.prepare('SELECT count(*) n FROM email_outbox').get().n, 1);
  const done = await sendQueuedEmail(c.env, a.id, options);
  assert.equal(done.accepted, true); assert.equal(done.delivery, null); assert.equal(c.calls.length, 1);
});
await test('a saved operation cannot change its recipient, edition or message', async c => {
  await queue(c);
  for (const override of [{ recipient: 'elsewhere@example.com' }, { versionId: 2 }, { message: { subject: 'Changed', text: 'Changed' } }]) {
    await assert.rejects(enqueueEmail(c.env, intent(override)), /conflicts/);
  }
  assert.equal(c.calls.length, 0);
});
await test('missing credentials leave a queued message without claiming acceptance', async c => {
  const row = await queue(c); delete c.env.RESEND_API_KEY;
  const result = await sendQueuedEmail(c.env, row.id, { now: c.now, fetcher: c.fetcher });
  assert.equal(result.accepted, false); assert.equal(result.status, 'queued'); assert.equal(c.calls.length, 0);
});
await test('lost acknowledgement reuses exact payload and provider idempotency key', async c => {
  const row = await queue(c), attempts = [];
  const fetcher = async (url, options) => { attempts.push(options); if (attempts.length === 1) throw Error('network lost'); return Response.json({ id: 'original-message' }); };
  assert.equal((await sendQueuedEmail(c.env, row.id, { now: c.now, fetcher })).status, 'uncertain');
  assert.equal((await sendQueuedEmail(c.env, row.id, { now: c.now + 1_000, fetcher })).accepted, true);
  assert.equal(attempts[0].body, attempts[1].body); assert.equal(attempts[0].headers['idempotency-key'], attempts[1].headers['idempotency-key']);
});
await test('unknown provider outcome past its deduplication window requires reconciliation', async c => {
  const row = await queue(c);
  await sendQueuedEmail(c.env, row.id, { now: c.now, fetcher: async () => { throw Error('lost'); } });
  const result = await sendQueuedEmail(c.env, row.id, { now: c.now + 24 * 3600_000, fetcher: c.fetcher });
  assert.equal(result.status, 'reconcile'); assert.equal(c.calls.length, 0);
});
await test('a stale sending lease can retry inside the deduplication window', async c => {
  const row = await queue(c);
  c.db.prepare("UPDATE email_outbox SET send_status='sending', first_attempt_ms=?, lease_started_ms=? WHERE id=?").run(c.now - 61_000, c.now - 61_000, row.id);
  assert.equal((await sendQueuedEmail(c.env, row.id, { now: c.now, fetcher: c.fetcher })).accepted, true);
  assert.equal(c.calls.length, 1);
});
await test('a stale sending lease past the deduplication window cannot blindly resend', async c => {
  const row = await queue(c), old = c.now - 24 * 3600_000;
  c.db.prepare("UPDATE email_outbox SET send_status='sending', first_attempt_ms=?, lease_started_ms=? WHERE id=?").run(old, old, row.id);
  assert.equal((await sendQueuedEmail(c.env, row.id, { now: c.now, fetcher: c.fetcher })).status, 'reconcile');
  assert.equal(c.calls.length, 0);
});
await test('provider rejection is retryable without leaking private response details', async c => {
  const row = await queue(c);
  const result = await sendQueuedEmail(c.env, row.id, { now: c.now, fetcher: async () => Response.json({ message: 'private provider detail' }, { status: 429 }) });
  assert.equal(result.status, 'failed'); assert(!JSON.stringify(c.db.prepare('SELECT * FROM email_outbox').get()).includes('private provider detail'));
  assert.equal((await sendQueuedEmail(c.env, row.id, { now: c.now + 1_000, fetcher: c.fetcher })).accepted, true);
});
await test('server errors and malformed success do not claim acceptance', async c => {
  const row = await queue(c);
  for (const response of [Response.json({}, { status: 503 }), Response.json({})]) {
    const result = await sendQueuedEmail(c.env, row.id, { now: c.now, fetcher: async () => response });
    assert.equal(result.status, 'uncertain'); assert.equal(result.accepted, false);
  }
});
await test('persisted production mail cannot replay in staging or development', async c => {
  const row = await queue(c);
  for (const INKSHEAF_ENV of ['staging', 'development']) await assert.rejects(sendQueuedEmail({ ...c.env, INKSHEAF_ENV, STAGING_EMAIL: 'tester@example.com' }, row.id, { fetcher: c.fetcher }), /environment/);
  assert.equal(c.calls.length, 0);
});
await test('staging persists only its allowlisted destination and blocks changed allowlists', async c => {
  c.env.INKSHEAF_ENV = 'staging'; c.env.STAGING_EMAIL = 'tester@example.com';
  const row = await queue(c); assert.deepEqual(JSON.parse(row.message_json).to, ['tester@example.com']);
  await assert.rejects(sendQueuedEmail({ ...c.env, STAGING_EMAIL: 'new-tester@example.com' }, row.id, { fetcher: c.fetcher }), /environment/);
  assert.equal((await sendQueuedEmail(c.env, row.id, { now: c.now, fetcher: c.fetcher })).accepted, true);
  assert.deepEqual(JSON.parse(c.calls[0].options.body).to, ['tester@example.com']);
});
await test('message corruption is held before any network request', async c => {
  const row = await queue(c);
  c.db.prepare("UPDATE email_outbox SET message_json = replace(message_json,'complete PDF','wrong book') WHERE id=?").run(row.id);
  await assert.rejects(sendQueuedEmail(c.env, row.id, { fetcher: c.fetcher }), /environment/); assert.equal(c.calls.length, 0);
});
await test('provider acceptance survives storage acknowledgement loss through the saved send key', async c => {
  const row = await queue(c), realPrepare = c.env.DB.prepare;
  c.env.DB.prepare = sql => { if (sql.includes('provider_id = COALESCE')) throw Error('database unavailable'); return realPrepare(sql); };
  await assert.rejects(sendQueuedEmail(c.env, row.id, { now: c.now, fetcher: c.fetcher }), /database unavailable/);
  c.env.DB.prepare = realPrepare;
  assert.equal(c.db.prepare('SELECT send_status FROM email_outbox').get().send_status, 'sending');
  assert.equal((await sendQueuedEmail(c.env, row.id, { now: c.now + 61_000, fetcher: c.fetcher })).accepted, true);
  assert.equal(c.calls[0].options.headers['idempotency-key'], c.calls[1].options.headers['idempotency-key']);
});
await test('a slow stale worker cannot overwrite a newer accepted lease', async c => {
  const row = await queue(c); let release, entered;
  const start = new Promise(resolve => { entered = resolve; });
  const old = sendQueuedEmail(c.env, row.id, { now: c.now, fetcher: async () => { entered(); return new Promise(resolve => { release = resolve; }); } });
  await start;
  assert.equal((await sendQueuedEmail(c.env, row.id, { now: c.now + 61_000, fetcher: c.fetcher })).accepted, true);
  release(Response.json({}, { status: 503 })); await old;
  assert.equal(c.db.prepare('SELECT send_status FROM email_outbox').get().send_status, 'accepted');
});
await test('delivery status and later replay cannot resend a bounced message automatically', async c => {
  const row = await queue(c); await sendQueuedEmail(c.env, row.id, { now: c.now, fetcher: c.fetcher });
  c.db.prepare("UPDATE email_outbox SET delivery_status='bounced' WHERE id=?").run(row.id);
  const replay = await sendQueuedEmail(c.env, row.id, { now: c.now + 30 * 86400_000, fetcher: c.fetcher });
  assert.equal(replay.accepted, true); assert.equal(replay.delivery, 'bounced'); assert.equal(c.calls.length, 1);
});
await test('repeated failure stops at a bounded number of provider attempts', async c => {
  const row = await queue(c); let attempts = 0;
  const fetcher = async () => { attempts++; return Response.json({}, { status: 503 }); };
  let result;
  for (let i = 0; i < 10; i++) result = await sendQueuedEmail(c.env, row.id, { now: c.now + i * 1_000, fetcher });
  assert.equal(attempts, 5); assert.equal(result.status, 'reconcile'); assert.equal(result.accepted, false);
});
console.log(`${passed} durable email outbox checks passed`);
