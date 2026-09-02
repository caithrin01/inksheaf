#!/usr/bin/env node
// Production feature gate. This is intentionally not a mock: it fails unless the deployed
// Inksheaf API can personalize several real publications through the same URL beta users call.
import { strict as assert } from "node:assert";

const base = (process.env.INKSHEAF_BASE_URL || "https://inksheaf.com").replace(/\/$/, "");
const cases = [
  ["Caithrin", "https://www.caithrin.com", "essays"],
  ["Letters from an American", "https://heathercoxrichardson.substack.com", "letters"],
  ["Slow Boring", "https://www.slowboring.com", "essays"],
  ["Razib Khan", "https://razib.substack.com", null],
];

/* FRESH=1: every request carries fresh=<hmac(host:fresh:bucket)> signed with the relay
   token, so the API skips its cache read and must fetch cold from origin. The shared cache
   is never cleared, so a scheduled check hitting production mid-gate cannot repopulate a
   host under the gate (that happened 2026-09-01). Needs the relay token; release gates only. */
let freshSign = null;
if (process.env.FRESH === "1") {
  const { createHmac } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  const token = process.env.ARCHIVE_RELAY_TOKEN ||
    readFileSync(`${process.env.HOME}/.secrets/inksheaf-relay-token`, "utf8").trim();
  freshSign = host => createHmac("sha256", token)
    .update(`${host}:fresh:${Math.floor(Date.now() / 300000)}`).digest("hex");
  console.log("FRESH: signed cold-origin requests for the gate hosts");
}
const gateHost = u => new URL(u).hostname;

let failures = 0;
let first = true;
for (const [label, publicationUrl, expectedKind] of cases) {
  if (!first && process.env.FRESH === "1") await new Promise(r => setTimeout(r, 6000));
  first = false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 45_000);
  try {
    const freshQ = freshSign ? `&fresh=${freshSign(gateHost(publicationUrl))}` : "";
    const r = await fetch(`${base}/api/preview?url=${encodeURIComponent(publicationUrl)}${freshQ}`,
      { signal: ctl.signal, headers: { accept: "application/json" } });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true, JSON.stringify(body));
    assert.equal(body.summary_version, 6);
    assert.ok(body.divisions && body.recommended, label + ": divisions plan present");
    assert.ok(body.publication && body.publication.length > 1);
    assert.ok(body.public_posts > 0);
    assert.ok(body.est_pages >= 32);
    if (expectedKind) assert.equal(body.kind, expectedKind);
    if (process.env.FRESH === "1") {
      // structural: a stale fallback also reports cached:false, so only served:"origin" counts
      assert.equal(body.served, "origin", label + ": expected a cold-origin fetch, served=" + body.served);
      assert.notEqual(body.stale, true, label + ": stale payload served as fresh");
      assert.ok(["relay", "direct"].includes(body.fetch_mode), label + ": fetch_mode " + body.fetch_mode);
      if (body.fetch_mode === "relay") {
        assert.ok(Number.isInteger(body.attempts) && body.attempts >= 1 && body.attempts <= 3, label + ": attempts " + body.attempts);
        assert.ok(body.latency_ms > 0 && body.latency_ms <= 40000, label + ": relay latency inside the 40s budget: " + body.latency_ms);
      }
    }
    console.log(`PASS LIVE ${label}: ${body.public_posts} ${body.kind}, ${body.est_pages}pp, ${body.fetch_mode}, served=${body.served}` +
      (body.attempts ? `, attempts=${body.attempts}, ${body.latency_ms}ms` : ""));
  } catch (e) {
    failures++;
    console.error(`FAIL LIVE ${label}: ${String(e?.message || e)}`);
  } finally { clearTimeout(timer); }
}

if (failures) {
  console.error(`\nLIVE PREVIEW GATE FAILED: ${failures}/${cases.length} real publications unavailable`);
  process.exit(1);
}
console.log(`\nPASS LIVE PREVIEW GATE: ${cases.length}/${cases.length} real publications`);
