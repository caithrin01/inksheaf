#!/usr/bin/env node
// Unit gate for the signup endpoint: mocked D1 captures the INSERT and proves the
// whitelisted fields, including plan_json, land in the bound values.
import { strict as assert } from "node:assert";
import { onRequest } from "../functions/api/signup.js";

function mockDB(log) {
  return { prepare(sql) { return { bind(...args) {
    return { first: async () => null, run: async () => { log.push({ sql, args }); } };
  }, first: async () => ({ n: 0 }), run: async () => { log.push({ sql, args: [] }); } }; } };
}
const req = (body) => ({ method: "POST",
  headers: { get: (h) => (h === "content-length" ? String(JSON.stringify(body).length) : null) },
  json: async () => body });

const log = [];
const plan = JSON.stringify({ cadence: "quarterly", interior: "color",
  volumes: [{ label: "Sep 2025", est_pages: 90 }], form: "a magazine", unit: "issue" });
const res = await onRequest({ request: req({
  publication_url: "https://example.substack.com", email: "test@example.com",
  cadence_pref: "quarterly", plan_json: plan, posts_per_year: "96" }), env: { DB: mockDB(log) } });
assert.equal(res.status, 200);
const insert = log.find(x => x.sql.includes("INSERT INTO signups"));
assert.ok(insert, "insert ran");
assert.ok(insert.sql.includes("plan_json"), "plan_json column in SQL");
const placeholders = (insert.sql.match(/\?/g) || []).length;
assert.equal(placeholders, insert.args.length, "placeholder count matches binds");
assert.ok(insert.args.includes(plan), "plan_json value bound");
assert.ok(plan.length > 100, "fixture plan is realistically sized");
{ const bigPlan = JSON.stringify({ cadence: "monthly", interior: "color",
    volumes: Array.from({ length: 12 }, (_, i) => ({ label: "Month " + i, from: "2025-09-01",
      to: "2025-09-30", posts: 8, words: 20000, est_pages: 82 })), form: "a magazine", unit: "issue" });
  const logB = [];
  await onRequest({ request: req({ publication_url: "https://c.substack.com",
    email: "c@example.com", plan_json: bigPlan }), env: { DB: mockDB(logB) } });
  const insB = logB.find(x => x.sql.includes("INSERT INTO signups"));
  assert.ok(insB.args.includes(bigPlan), "a 12-volume plan survives whole: " + bigPlan.length + " chars");
}
assert.ok(insert.args.includes("quarterly"), "cadence_pref bound");

/* honeypot: pretends success, stores nothing */
const log2 = [];
const res2 = await onRequest({ request: req({ website: "spam", email: "x@y.z",
  publication_url: "https://a.substack.com" }), env: { DB: mockDB(log2) } });
assert.equal(res2.status, 200);
assert.ok(!log2.find(x => x.sql.includes("INSERT INTO signups")), "honeypot stores nothing");

/* oversized plan_json is truncated, not fatal */
const log3 = [];
const res3 = await onRequest({ request: req({ publication_url: "https://b.substack.com",
  email: "b@example.com", plan_json: "x".repeat(9000) }), env: { DB: mockDB(log3) } });
assert.equal(res3.status, 200);
const ins3 = log3.find(x => x.sql.includes("INSERT INTO signups"));
assert.ok(ins3.args.some(a => typeof a === "string" && a.length === 4096), "plan_json capped at 4096");

console.log("PASS SIGNUP unit: plan_json bound, honeypot inert, oversize capped");
