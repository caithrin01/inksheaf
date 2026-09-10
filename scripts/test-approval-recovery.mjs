import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { onRequest } from '../functions/api/approve.js';

const nonce = 'a'.repeat(36), originalFetch = globalThis.fetch;
function setup() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync(`migrations/${file}`, 'utf8'));
  db.exec("INSERT INTO signups (id,publication_url,email,raw_json,plan_json,email_verified_at) VALUES (1,'https://writer.substack.com','owner@example.com','{}','{}',datetime('now'))");
  db.prepare(`INSERT INTO edition_versions (id,signup_id,plan_json,post_ids,body_hashes,renderer_sha,print_mode,volumes,status,approval_nonce,proof_sha256,pages)
    VALUES (1,1,'{}','[1,2]','{}','fixture','bw','[{"label":"2026","pages":150}]','proofed',?,?,150)`).run(nonce, 'f'.repeat(64));
  const DB = { prepare(sql) { const stmt = db.prepare(sql); let args = []; return {
    bind(...values) { args = values; return this; }, async first() { return stmt.get(...args) || null; },
    async run() { const r = stmt.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  }; } };
  const env = { DB, INKSHEAF_ENV: 'production', GITHUB_DISPATCH_TOKEN: 'test-only' }, calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return new Response(null, { status: 204 }); };
  return { db, env, calls };
}
function call(c, method = 'POST') {
  const body = new FormData(); body.set('v', '1'); body.set('n', nonce);
  return onRequest({ request: new Request(`https://inksheaf.com/api/approve?v=1&n=${nonce}`, { method, ...(method === 'POST' ? { body } : {}) }), env: c.env });
}
let passed = 0;
async function test(name, run) { const c = setup(); try { await run(c); passed++; console.log('PASS', name); } finally { c.db.close(); globalThis.fetch = originalFetch; } }
await test('HEAD is read-only and unsupported methods cannot approve or dispatch a book', async c => {
  assert.equal((await call(c, 'HEAD')).status, 200);
  for (const method of ['OPTIONS', 'PUT', 'DELETE']) assert.equal((await call(c, method)).status, 405);
  assert.equal(c.calls.length, 0); assert.equal(c.db.prepare('SELECT status FROM edition_versions').get().status, 'proofed');
});
await test('scanner GET is read-only and a valid explicit POST approves once', async c => {
  assert.equal((await call(c, 'GET')).status, 200); assert.equal(c.calls.length, 0);
  const results = await Promise.all([call(c), call(c)]);
  assert(results.some(r => r.status === 200)); assert.equal(c.calls.length, 1);
  assert.equal(c.db.prepare('SELECT status FROM edition_versions').get().status, 'approved');
  await call(c); assert.equal(c.calls.length, 1);
});
await test('a requested revision makes the previous proof ineligible immediately', async c => {
  c.db.exec(`UPDATE signups SET plan_json='{"changed_at":"2026-09-08"}'`);
  for (const method of ['GET', 'POST']) assert.equal((await call(c, method)).status, 409);
  assert.equal(c.calls.length, 0); assert.equal(c.db.prepare('SELECT approval_nonce FROM edition_versions').get().approval_nonce, nonce);
});
await test('a newer version blocks an old proof even if both plans are identical', async c => {
  c.db.exec("INSERT INTO edition_versions (id,signup_id,plan_json,post_ids,body_hashes,renderer_sha,print_mode,volumes) SELECT 2,signup_id,plan_json,post_ids,body_hashes,renderer_sha,print_mode,volumes FROM edition_versions WHERE id=1");
  assert.equal((await call(c)).status, 409); assert.equal(c.calls.length, 0);
});
await test('a revision racing the approval claim is caught inside the SQL transition', async c => {
  const prepare = c.env.DB.prepare;
  c.env.DB.prepare = sql => {
    if (sql.startsWith("UPDATE edition_versions SET status = 'approved'")) c.db.exec(`UPDATE signups SET plan_json='{"changed_at":"just now"}'`);
    return prepare(sql);
  };
  assert.equal((await call(c)).status, 409); assert.equal(c.calls.length, 0);
  assert.equal(c.db.prepare('SELECT status FROM edition_versions').get().status, 'proofed');
});
await test('a new version racing the claim cannot publish the old proof', async c => {
  const prepare = c.env.DB.prepare;
  c.env.DB.prepare = sql => {
    if (sql.startsWith("UPDATE edition_versions SET status = 'approved'")) c.db.exec("INSERT INTO edition_versions (id,signup_id,plan_json,post_ids,body_hashes,renderer_sha,print_mode,volumes) SELECT 2,signup_id,plan_json,post_ids,body_hashes,renderer_sha,print_mode,volumes FROM edition_versions WHERE id=1");
    return prepare(sql);
  };
  assert.equal((await call(c)).status, 409); assert.equal(c.calls.length, 0);
});
await test('ownership must be confirmed before approving a PDF', async c => {
  c.db.exec('UPDATE signups SET email_verified_at=NULL');
  assert.equal((await call(c)).status, 409); assert.equal(c.calls.length, 0);
});
await test('publication-derived volume labels are escaped on the confirmation page', async c => {
  c.db.prepare('UPDATE edition_versions SET volumes=?').run(JSON.stringify([{ label: '<img src=x onerror=alert(1)>', pages: 100 }, { label: 'Second & last', pages: 100 }]));
  const text = await (await call(c, 'GET')).text();
  assert(!text.includes('<img src=x')); assert(text.includes('&lt;img src=x')); assert(text.includes('Second &amp; last'));
});
await test('dispatch failure preserves approval and gives no invented deadline', async c => {
  delete c.env.GITHUB_DISPATCH_TOKEN;
  const response = await call(c); assert.equal(response.status, 200);
  const text = await response.text(); assert(text.includes('waiting for follow-up')); assert(!text.includes('follows today'));
  assert.equal(c.db.prepare('SELECT status FROM edition_versions').get().status, 'building-final');
});
await test('an approval storage failure is an explicit retryable error', async c => {
  const prepare = c.env.DB.prepare;
  c.env.DB.prepare = sql => {
    const stmt = prepare(sql);
    if (sql.startsWith("UPDATE edition_versions SET status = 'approved'")) stmt.run = async () => { throw Error('database unavailable'); };
    return stmt;
  };
  assert.equal((await call(c)).status, 503); assert.equal(c.calls.length, 0);
});
console.log(`${passed} approval recovery checks passed`);
