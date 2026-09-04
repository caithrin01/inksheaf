#!/usr/bin/env node
import { strict as assert } from "node:assert";
import { funnelHost, funnelSession, recordFunnel, recordVerifiedFunnel, sendFunnelAlert } from "../functions/lib/funnel.js";

function mockDB() {
  const rows = new Map(), cache = new Set(["www.example.substack.com"]);
  return { rows, prepare(sql) { let args = []; const stmt = {
    bind(...a) { args = a; return stmt; },
    async first() {
      if (/SELECT host FROM preview_cache/.test(sql)) return [...cache].includes(args[0]) || [...cache].includes(args[1]) ? { host: args[0] } : null;
      if (/SELECT count\(\*\) n FROM funnel_sessions/.test(sql)) return { n: 0 };
      if (/SELECT session, host FROM funnel_sessions WHERE signup_id/.test(sql))
        return [...rows.values()].find(r => r.signup_id === args[0]) || null;
      return null;
    },
    async run() {
      if (/INSERT INTO funnel_sessions/.test(sql)) {
        const [session, host, event, signupId] = args, key = `${session}:${host}`;
        const row = rows.get(key) || { session, host };
        row.last_event = event; if (signupId) row.signup_id = signupId;
        for (const field of ["preview_ok_at","preview_failed_at","reserve_started_at","signup_at","verified_at"])
          if (sql.includes(`${field}, signup_id`) || sql.includes(`${field} = COALESCE`)) row[field] ||= "now";
        rows.set(key, row); return { meta: { changes: 1 } };
      }
      const alert = /SET (alerted_(?:preview|signup|verified)_at)/.exec(sql);
      if (alert) {
        const row = rows.get(`${args[0]}:${args[1]}`);
        if (row && !row[alert[1]]) { row[alert[1]] = "now"; return { meta: { changes: 1 } }; }
        return { meta: { changes: 0 } };
      }
      return { meta: { changes: 1 } };
    }
  }; return stmt; } };
}

assert.equal(funnelHost("https://WWW.Example.Substack.com/a"), "example.substack.com");
assert.equal(funnelHost("localhost"), null);
assert.equal(funnelSession("ABC12345"), "abc12345");
assert.equal(funnelSession("bad"), null);

const DB = mockDB();
const env = { DB, INKSHEAF_ENV: "production", FUNNEL_ALERT_EMAIL: "owner@example.com", RESEND_API_KEY: "test" };
let r = await recordFunnel(env, { session: "abc12345", host: "example.substack.com", event: "preview_ok" });
assert.equal(r.alert, true, "first real preview claims one owner alert");
r = await recordFunnel(env, { session: "abc12345", host: "example.substack.com", event: "preview_ok" });
assert.equal(r.alert, false, "repeat preview does not claim another alert");
r = await recordFunnel(env, { session: "robot123", host: "example.substack.com", event: "preview_ok", automated: true });
assert.equal(r.alert, false, "browser automation is tracked but never emails the owner");
r = await recordFunnel(env, { session: "abc12345", host: "example.substack.com", event: "signup", signup_id: 42 });
assert.equal(r.alert, true, "signup claims its completion alert");
r = await recordVerifiedFunnel(env, 42);
assert.equal(r.alert, true, "verification joins through signup_id and claims its alert");
assert.equal(DB.rows.get("abc12345:example.substack.com").last_event, "verified");

let sent;
const oldFetch = global.fetch;
global.fetch = async (_url, options) => { sent = JSON.parse(options.body); return { ok: true, status: 200 }; };
const mail = await sendFunnelAlert({ INKSHEAF_ENV: "staging", STAGING_EMAIL: "qa@inksheaf.com",
  FUNNEL_ALERT_EMAIL: "owner@example.com", RESEND_API_KEY: "test" },
  { alert: true, stage: "signup", host: "example.substack.com", session: "abc12345", signup_id: 42, email: "writer@example.com" });
global.fetch = oldFetch;
assert.equal(mail.sent, true);
assert.deepEqual(sent.to, ["qa@inksheaf.com"], "staging alert is rerouted to the one test inbox");
assert.match(sent.subject, /^\[staging\] Reservation started:/);
assert.match(sent.text, /Intended recipient: owner@example.com/);
assert.match(sent.text, /Signup: 42/);

console.log("funnel: 14 pass, 0 fail");
