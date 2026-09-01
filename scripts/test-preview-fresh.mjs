#!/usr/bin/env node
// Unit test for the signed fresh= cache bypass in functions/api/preview.js (launch-hardening,
// 2026-09-01). Fake D1, stubbed fetch, one cached host. The cache read must be skipped only
// when fresh= carries a valid HMAC of host:fresh:bucket under ARCHIVE_RELAY_TOKEN; a missing,
// wrong or stale signature serves the cache as before. A fresh read still writes the cache.
import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { onRequest } from "../functions/api/preview.js";

const HOST = "fresh-test.substack.com";
const TOKEN = "unit-test-token";
const sign = (host, bucket) => createHmac("sha256", TOKEN).update(`${host}:fresh:${bucket}`).digest("hex");
const bucket = () => Math.floor(Date.now() / 300000);

const posts = Array.from({ length: 6 }, (_, i) => ({
  title: `Post ${i + 1}`, post_date: new Date(Date.now() - i * 86400e3).toISOString(),
  wordcount: 1200, canonical_url: `https://${HOST}/p/post-${i + 1}`, audience: "everyone",
  publishedBylines: [{ name: "Unit Author", publicationUsers: [{ publication: { name: "Unit Pub" } }] }],
}));

const log = [];
function fakeDb(cachedPayload) {
  return { prepare(sql) {
    const stmt = { args: [], bind(...a) { stmt.args = a; return stmt; },
      async first() { log.push(sql.slice(0, 40));
        if (sql.startsWith("SELECT payload")) return cachedPayload
          ? { payload: JSON.stringify(cachedPayload), fetched_at: new Date().toISOString() } : null;
        return { n: 0 }; },
      async run() { log.push(sql.slice(0, 40)); return {}; } };
    return stmt; } };
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = new URL(url);
  log.push(`fetch ${u.hostname}`);
  const offset = Number(u.searchParams.get("offset") || 0);
  return new Response(JSON.stringify(offset ? [] : posts), { status: 200,
    headers: { "content-type": "application/json" } });
};

async function call(query, env) {
  const request = new Request(`https://inksheaf.com/api/preview?url=https://${HOST}${query}`);
  const r = await onRequest({ request, env });
  return { status: r.status, body: await r.json() };
}

const cachedPayload = { summary_version: 5, marker: "from-cache" };
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name}`); } };

try {
  // 1. no fresh param: cache serves
  log.length = 0;
  let r = await call("", { DB: fakeDb(cachedPayload), ARCHIVE_RELAY_TOKEN: TOKEN });
  ok("plain request served from cache", r.body.served === "cache" && r.body.marker === "from-cache");
  ok("plain request read the cache", log.some(l => l.startsWith("SELECT payload")));
  ok("plain request never fetched origin", !log.some(l => l.startsWith("fetch")));

  // 2. valid signature, current bucket: cache skipped, origin read, cache written
  log.length = 0;
  r = await call(`&fresh=${sign(HOST, bucket())}`, { DB: fakeDb(cachedPayload), ARCHIVE_RELAY_TOKEN: TOKEN });
  ok("signed fresh request served from origin", r.status === 200 && r.body.served === "origin");
  ok("signed fresh request skipped the cache read", !log.some(l => l.startsWith("SELECT payload")));
  ok("signed fresh request fetched origin", log.some(l => l === `fetch ${HOST}`));
  ok("signed fresh request wrote the cache", log.some(l => l.startsWith("INSERT INTO preview_cache")));

  // 3. previous bucket still accepted (a gate that straddles a 5-minute boundary)
  log.length = 0;
  r = await call(`&fresh=${sign(HOST, bucket() - 1)}`, { DB: fakeDb(cachedPayload), ARCHIVE_RELAY_TOKEN: TOKEN });
  ok("previous-bucket signature accepted", r.body.served === "origin");

  // 4. wrong token, stale bucket, garbage: cache serves
  for (const [name, sig] of [
    ["wrong token", createHmac("sha256", "other").update(`${HOST}:fresh:${bucket()}`).digest("hex")],
    ["stale bucket", sign(HOST, bucket() - 2)],
    ["other host's signature", sign("other.substack.com", bucket())],
    ["garbage", "deadbeef"],
  ]) {
    log.length = 0;
    r = await call(`&fresh=${sig}`, { DB: fakeDb(cachedPayload), ARCHIVE_RELAY_TOKEN: TOKEN });
    ok(`${name}: cache still serves`, r.body.served === "cache" && !log.some(l => l.startsWith("fetch")));
  }

  // 5. no token configured: fresh is inert
  log.length = 0;
  r = await call(`&fresh=${sign(HOST, bucket())}`, { DB: fakeDb(cachedPayload) });
  ok("no ARCHIVE_RELAY_TOKEN: fresh ignored", r.body.served === "cache");
} finally { globalThis.fetch = realFetch; }

assert.equal(fail, 0, `${fail} failures`);
console.log(`preview fresh: ${pass} pass, ${fail} fail`);
