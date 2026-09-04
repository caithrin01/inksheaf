#!/usr/bin/env node
// Regression test for the understandingai.org incident (2026-09-01 15:27 PDT). The direct
// archive read failed on a retryable status, the relay failed three times in 31s, and the
// page told the writer "Could not find a Substack archive there. Check the address?" for a
// real, live Substack. A relay failure after a retryable direct failure is an outage or a
// block, never evidence about the address. Expected now: 503 upstream_busy with a message
// that names the outage and offers retry plus the hand-built route, for every relay error
// text the relay can emit. The stale-cache fallback and the true not-Substack path (direct
// 404 on apex and www) are asserted alongside so the fix cannot widen into either.
// Runs against the real retry schedule (2.5s + 6s waits per case), about 80s in all.
import { strict as assert } from "node:assert";
import { onRequest } from "../functions/api/preview.js";

const HOST = "outage-test.substack.com";
const TOKEN = "unit-test-token";
const RELAY_HOST = "caithrin--inksheaf-archive-relay-archive.modal.run";
const DOH_HOST = "cloudflare-dns.com";

let relayDetail = "upstream unavailable";
let directStatus = 503;
let directDelayMs = 0;
let relayDelayMs = 0;
let dnsStatus = 0;           // 0 = the host resolves, 3 = NXDOMAIN
let directThrows = false;    // a DNS or connection failure throws instead of returning a status
const log = [];
const realFetch = globalThis.fetch;
/* honours the abort signal the way a real fetch does, so the budget maths is exercised */
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); });
});
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  log.push(`fetch ${u.hostname} ${u.pathname}`);
  if (u.hostname === DOH_HOST)
    return new Response(JSON.stringify({ Status: dnsStatus, Answer: dnsStatus ? [] : [{ data: "203.0.113.7" }] }), { status: 200 });
  if (u.hostname === RELAY_HOST) {
    if (relayDelayMs) await sleep(relayDelayMs, opts.signal);
    return new Response(JSON.stringify({ detail: relayDetail }), { status: 503 });
  }
  if (directDelayMs) await sleep(directDelayMs, opts.signal);
  if (directThrows) throw new TypeError("fetch failed");
  return new Response("", { status: directStatus });
};

function fakeDb(cachedPayload) {
  return { prepare(sql) {
    const stmt = { bind() { return stmt; },
      async first() {
        if (sql.startsWith("SELECT payload")) return cachedPayload
          ? { payload: JSON.stringify(cachedPayload), fetched_at: "2026-01-01T00:00:00Z" } : null;
        return { n: 0 }; },
      async run() { return {}; } };
    return stmt; } };
}

async function call(env, host = HOST) {
  const request = new Request(`https://inksheaf.com/api/preview?url=https://${host}`);
  const t0 = Date.now();
  const r = await onRequest({ request, env });
  return { status: r.status, body: await r.json(), ms: Date.now() - t0 };
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}${extra ? "  " + extra : ""}`); }
};

try {
  // 1. every relay error text the relay can emit: never "check the address"
  for (const detail of ["upstream unavailable", "upstream 503", "upstream 429", "upstream 404",
    "invalid upstream JSON", "response too large"]) {
    relayDetail = detail; directStatus = 503; log.length = 0;
    const r = await call({ DB: fakeDb(null), ARCHIVE_RELAY_TOKEN: TOKEN });
    const msg = String(r.body.message || "");
    ok(`relay "${detail}": status 503, not 422`, r.status === 503, `got ${r.status}`);
    ok(`relay "${detail}": error upstream_busy`, r.body.error === "upstream_busy", `got ${r.body.error}`);
    ok(`relay "${detail}": message never blames the address`, !/address|Substack archive there/i.test(msg), msg);
    ok(`relay "${detail}": message offers retry and the hand-built route`, /Try again/.test(msg) && /by hand/.test(msg), msg);
    ok(`relay "${detail}": relay was tried more than once`, r.body.attempts >= 2, `attempts ${r.body.attempts}`);
    ok(`relay "${detail}": detail carries the relay's reason`, String(r.body.detail).includes(detail), r.body.detail);
  }

  // 2. a 429 from the direct read takes the same path
  relayDetail = "upstream unavailable"; directStatus = 429;
  let r = await call({ DB: fakeDb(null), ARCHIVE_RELAY_TOKEN: TOKEN });
  ok("direct 429 then relay failure: 503 upstream_busy", r.status === 503 && r.body.error === "upstream_busy");

  // 3. stale cache still serves through an outage
  directStatus = 503;
  r = await call({ DB: fakeDb({ summary_version: 7, marker: "stale-row", host: HOST }), ARCHIVE_RELAY_TOKEN: TOKEN });
  ok("stale cache row served during an outage", r.status === 200 && r.body.marker === "stale-row" && r.body.stale === true,
    `status ${r.status} error ${r.body.error}`);

  // 4. the true not-Substack path is untouched: direct 404 on apex and on www
  directStatus = 404; log.length = 0;
  r = await call({ DB: fakeDb(null), ARCHIVE_RELAY_TOKEN: TOKEN }, "outage-test.example");
  ok("direct 404 on apex and www: still 422 not_substack", r.status === 422 && r.body.error === "not_substack", `got ${r.status} ${r.body.error}`);
  ok("direct 404: relay never called", !log.some(l => l.includes(RELAY_HOST)));
  ok("direct 404: www was tried once", log.some(l => l.startsWith("fetch www.outage-test.example")));

  // 5. a domain that does not exist is the writer's typo: the address message, 422,
  //    answered at once (no relay sweep) when the direct read threw
  directThrows = true; dnsStatus = 3; relayDetail = "upstream unavailable"; log.length = 0;
  r = await call({ DB: fakeDb(null), ARCHIVE_RELAY_TOKEN: TOKEN }, "no-such-publication-4f9a1c.com");
  ok("dead domain: 422 not_substack with the address message", r.status === 422 && /Check the address/.test(r.body.message), `${r.status} ${r.body.message}`);
  ok("dead domain: the resolver was asked", log.some(l => l.startsWith(`fetch ${DOH_HOST}`)));
  ok("dead domain: answered inside 2s, relay never called", r.ms < 2000 && !log.some(l => l.includes(RELAY_HOST)), `${r.ms}ms`);
  // a live host whose direct read threw (connection reset) still goes to the relay
  dnsStatus = 0; log.length = 0;
  r = await call({ DB: fakeDb(null), ARCHIVE_RELAY_TOKEN: TOKEN });
  ok("thrown direct read on a live host: relay tried, 503", r.status === 503 && log.some(l => l.includes(RELAY_HOST)), `${r.status}`);
  // relay failure with a host that resolved at first but is gone by the end: still the address message
  directThrows = false; directStatus = 503; dnsStatus = 3; log.length = 0;
  r = await call({ DB: fakeDb(null), ARCHIVE_RELAY_TOKEN: TOKEN }, "no-such-publication-4f9a1c.com");
  ok("dead domain after a relay sweep: still the address message", r.status === 422 && /Check the address/.test(r.body.message));
  dnsStatus = 0;

  // 6. a live domain during an outage never triggers the address message, and the
  //    resolver is only consulted on the failure path
  log.length = 0;
  r = await call({ DB: fakeDb(null), ARCHIVE_RELAY_TOKEN: TOKEN });
  ok("live domain in outage: resolver asked, still 503", r.status === 503 && log.some(l => l.startsWith(`fetch ${DOH_HOST}`)));
  directStatus = 404; log.length = 0;
  r = await call({ DB: fakeDb(null), ARCHIVE_RELAY_TOKEN: TOKEN }, "outage-test.example");
  ok("direct 404: resolver never asked", !log.some(l => l.startsWith(`fetch ${DOH_HOST}`)));

  // 7. a slow direct read plus a slow relay: the whole answer lands inside the 40s budget,
  //    under the page's 45s abort. Before the clock moved to the start of the read, a
  //    blackhole host took the server 46s on 2026-09-01 and the page gave up first.
  directStatus = 503; directDelayMs = 5500; relayDelayMs = 20000; relayDetail = "upstream unavailable";
  r = await call({ DB: fakeDb(null), ARCHIVE_RELAY_TOKEN: TOKEN });
  ok("slow direct and slow relay: answer inside 42s", r.ms < 42000, `${r.ms}ms, latency_ms ${r.body.latency_ms}`);
  ok("slow direct and slow relay: still 503 upstream_busy", r.status === 503 && r.body.error === "upstream_busy", `${r.status} ${r.body.error} ${r.body.detail}`);
  directDelayMs = 0; relayDelayMs = 0;
} finally { globalThis.fetch = realFetch; }

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
