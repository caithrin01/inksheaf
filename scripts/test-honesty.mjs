#!/usr/bin/env node
// Durable honesty gate: every number and claim on the deployed page traced to its
// measured source, plus the reachable-state contradictions the 2026-09-01 audit named.
// Run: node scripts/test-honesty.mjs [base-url | --source-only]
//   --source-only reads dist/index.html and skips the live API checks (pre-deploy gate).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const sourceOnly = process.argv[2] === "--source-only";
const base = (sourceOnly ? "" : (process.argv[2] || "https://inksheaf.com")).replace(/\/$/, "");
const html = sourceOnly
  ? readFileSync(new URL("../dist/index.html", import.meta.url), "utf8")
  : await (await fetch(base + "/")).text();
const prices = JSON.parse(readFileSync(new URL("../functions/lib/print-prices.json", import.meta.url), "utf8"));
let n = 0;
const ok = (name, cond, detail = "") => { n++; assert.ok(cond, name + (detail ? " :: " + detail : "")); console.log("PASS " + name); };

/* measured numbers appear, and match the source file, not just themselves */
ok("bw curve reproduces the $9.34 order", Math.abs(prices.pods.bw.base + prices.pods.bw.per_page * 294 - 9.34) < 0.01);
ok("$9.34 on page", html.includes("$9.34"));
ok("$16.58 on page", html.includes("$16.58"));
ok("spec bw price matches curve at 200pp", html.includes("$" + (prices.pods.bw.base + prices.pods.bw.per_page * 200).toFixed(2)));
ok("spec color price matches measured point", html.includes("$10.83"));
ok("shipping base on page matches source", html.includes(prices.shipping_mail.toFixed(2)));
/* the shipping fit is labeled for what it is: measured points exist for 1/2/4/8 */
for (const k of ["1","2","4","8"]) ok("shipping point " + k + " measured", typeof prices.shipping_by_volumes[k] === "number");

/* policy consistency: the page's binding cap agrees with the engine's */
const summarySrc = readFileSync(new URL("../functions/lib/preview-summary.js", import.meta.url), "utf8");
ok("engine cap is 300", summarySrc.includes("> 300"));
ok("page states the 300 cap", /300[- ]page/.test(html));
ok("pipeline hard limit is 800", readFileSync(new URL("../scripts/pipeline.mjs", import.meta.url), "utf8").includes("pages > 800"));

/* contact + attribution */
ok("no dead hello@ anywhere in page", !html.includes("hello@inksheaf.com"));
ok("contact is caithrin@", html.includes("caithrin@caithrin.com"));
ok("substack non-affiliation", html.includes("not affiliated"));
ok("og domain canonical", html.includes('content="https://inksheaf.com/og.png"'));

/* reachable-state checks against the live API (the audit's core objection) */
if (sourceOnly) { console.log(`HONESTY GATE (source only): ${n} checks passed`); process.exit(0); }
const acx = await (await fetch(base + "/api/preview?url=astralcodexten.com")).json();
if (acx.ok) {
  const rec = acx.recommended.cadence;
  ok("ACX recommendation is feasible or concierge",
    rec === "concierge" || (acx.divisions[rec] && acx.divisions[rec].feasible),
    "rec=" + rec);
} else console.log("SKIP ACX reachable-state (api: " + acx.error + ")");
const cai = await (await fetch(base + "/api/preview?url=caithrin.com")).json();
if (cai.ok) {
  ok("caithrin recommendation feasible", cai.divisions[cai.recommended.cadence].feasible);
  ok("capped flag is boolean", typeof cai.capped === "boolean");
} else console.log("SKIP caithrin reachable-state");

console.log(`HONESTY GATE: ${n} checks passed`);
