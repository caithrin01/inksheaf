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

/* FRESH=1: clear the D1 cache for the gate hosts first and require cold-origin fetches.
   Needs local wrangler auth; use for release gates, not the scheduled availability cron. */
if (process.env.FRESH === "1") {
  const { execSync } = await import("node:child_process");
  const hosts = ["www.caithrin.com", "heathercoxrichardson.substack.com", "www.slowboring.com", "razib.substack.com"];
  execSync(`npx wrangler d1 execute inksheaf-beta --remote --command "DELETE FROM preview_cache WHERE host IN (${hosts.map(h => `'${h}'`).join(",")})"`,
    { stdio: "inherit" });
  console.log("cache cleared for gate hosts; requiring cold-origin fetches");
}

let failures = 0;
let first = true;
for (const [label, publicationUrl, expectedKind] of cases) {
  if (!first && process.env.FRESH === "1") await new Promise(r => setTimeout(r, 6000));
  first = false;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 45_000);
  try {
    const r = await fetch(`${base}/api/preview?url=${encodeURIComponent(publicationUrl)}`,
      { signal: ctl.signal, headers: { accept: "application/json" } });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true, JSON.stringify(body));
    assert.equal(body.summary_version, 3);
    assert.ok(body.divisions && body.recommended, label + ": divisions plan present");
    assert.ok(body.publication && body.publication.length > 1);
    assert.ok(body.public_posts > 0);
    assert.ok(body.est_pages >= 32);
    if (expectedKind) assert.equal(body.kind, expectedKind);
    if (process.env.FRESH === "1") assert.equal(body.cached, false, label + ": expected a cold-origin fetch");
    console.log(`PASS LIVE ${label}: ${body.public_posts} ${body.kind}, ${body.est_pages}pp, ${body.fetch_mode}${body.cached ? ", cached" : ""}`);
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
