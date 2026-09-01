#!/usr/bin/env node
// Relay reliability sample (launch-hardening 2.1). The relay is the only path to an
// archive for hosts that block Cloudflare, so its latency and error rate decide whether a
// friend sees a preview or the hand-built offer. 20 cold requests across five small and
// mid-size *.substack.com archives, spaced 15s, cold=1 so the relay's 10-minute result
// store is bypassed, measured from this process's wall clock
// (Workers freeze Date.now() between I/O, so the API's latency_ms is not this number).
// Pass: 19/20 succeed and p95 under 30s. Writes the latency table to the evidence dir.
// Token: ARCHIVE_RELAY_TOKEN or ~/.secrets/inksheaf-relay-token.
// Usage: node scripts/test-relay-sample.mjs [--quick]   (--quick: 5 requests, same spacing)
import { createHmac } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RELAY = "https://caithrin--inksheaf-archive-relay-archive.modal.run";
const HOSTS = ["razib.substack.com", "whattocook.substack.com", "poetryunbound.substack.com",
  "mayacpopa.substack.com", "statuskuo.substack.com"];
const quick = process.argv.includes("--quick");
const N = quick ? 5 : 20;
const SPACING_MS = 15000;
const PER_REQUEST_MS = 40000;
const MIN_OK = quick ? N - 1 : 19;
const P95_MAX_MS = 30000;

function token() {
  if (process.env.ARCHIVE_RELAY_TOKEN) return process.env.ARCHIVE_RELAY_TOKEN;
  const p = `${process.env.HOME}/.secrets/inksheaf-relay-token`;
  if (!existsSync(p)) throw new Error(`relay token missing: set ARCHIVE_RELAY_TOKEN or create ${p}`);
  return readFileSync(p, "utf8").trim();
}
const secret = token();
const sign = m => createHmac("sha256", secret).update(m).digest("hex");

const rows = [];
for (let i = 0; i < N; i++) {
  if (i) await new Promise(r => setTimeout(r, SPACING_MS));
  const host = HOSTS[i % HOSTS.length];
  const bucket = Math.floor(Date.now() / 300000);
  const url = `${RELAY}?host=${encodeURIComponent(host)}&mode=all&cold=1&sig=${sign(`${host}:all:${bucket}`)}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PER_REQUEST_MS);
  const t0 = performance.now();
  const row = { i: i + 1, host, at: new Date().toISOString() };
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } });
    const text = await r.text();
    row.ms = Math.round(performance.now() - t0);
    row.status = r.status;
    if (r.ok) {
      const posts = JSON.parse(text);
      row.ok = Array.isArray(posts);
      row.posts = row.ok ? posts.length : null;
      row.complete = r.headers.get("x-archive-complete") !== "0";
    } else { row.ok = false; row.error = text.slice(0, 80); }
  } catch (e) {
    row.ms = Math.round(performance.now() - t0);
    row.ok = false; row.error = String(e?.message || e).slice(0, 80);
  } finally { clearTimeout(timer); }
  rows.push(row);
  console.log(`${row.ok ? "ok  " : "FAIL"} ${String(row.i).padStart(2)} ${host.padEnd(28)} ${String(row.ms).padStart(6)}ms` +
    (row.ok ? ` ${row.posts} posts${row.complete ? "" : " (capped)"}` : ` ${row.status || ""} ${row.error}`));
}

const okRows = rows.filter(r => r.ok);
const sorted = okRows.map(r => r.ms).sort((a, b) => a - b);
const pct = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null;
const summary = { date: new Date().toISOString(), requests: N, ok: okRows.length,
  p50_ms: pct(0.5), p95_ms: pct(0.95), max_ms: sorted.at(-1) ?? null,
  by_host: Object.fromEntries(HOSTS.map(h => {
    const hs = rows.filter(r => r.host === h);
    return [h, { ok: hs.filter(r => r.ok).length, of: hs.length,
      mean_ms: hs.length ? Math.round(hs.reduce((s, r) => s + r.ms, 0) / hs.length) : null }];
  })), rows };

const evidenceDir = process.env.INKSHEAF_EVIDENCE_DIR ||
  `${process.env.HOME}/Library/Mobile Documents/com~apple~CloudDocs/Caithrin/05-Projects/Substack Magazine/evidence`;
try {
  mkdirSync(evidenceDir, { recursive: true });
  const out = join(evidenceDir, `relay-sample-${summary.date.slice(0, 10)}${quick ? "-quick" : ""}.json`);
  writeFileSync(out, JSON.stringify(summary, null, 2) + "\n");
  console.log(`wrote ${out}`);
} catch (e) { console.log(`evidence not written (${e.message})`); }

console.log(`\n| host | ok | mean |\n|---|---|---|`);
for (const [h, s] of Object.entries(summary.by_host)) console.log(`| ${h} | ${s.ok}/${s.of} | ${s.mean_ms}ms |`);
console.log(`\nok ${summary.ok}/${N}, p50 ${summary.p50_ms}ms, p95 ${summary.p95_ms}ms, max ${summary.max_ms}ms`);

const pass = summary.ok >= MIN_OK && summary.p95_ms !== null && summary.p95_ms < P95_MAX_MS;
console.log(pass ? `RELAY SAMPLE PASS (${MIN_OK}/${N} needed, p95 under ${P95_MAX_MS / 1000}s)`
  : `RELAY SAMPLE FAIL (need ${MIN_OK}/${N} ok and p95 under ${P95_MAX_MS / 1000}s)`);
process.exit(pass ? 0 : 1);
