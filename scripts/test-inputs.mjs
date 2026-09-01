#!/usr/bin/env node
// Hostile-input battery (beta-launch-readiness Track B), frozen from the Phase 1/2 sweeps.
// Every row is typed into the real page in a real browser. Pass condition per row: the
// expected outcome (a personalized preview, or an honest message matching the regex),
// the specimen book still visible, the hand-built offer shown on every failure, and zero
// pageerrors. Runs against production by default; pass a base URL to gate a preview deploy.
// Usage: node scripts/test-inputs.mjs [chromium|webkit|firefox] [base]
import { strict as assert } from "node:assert";

const engineName = process.argv[2] || "chromium";
const base = (process.argv[3] || "https://inksheaf.com").replace(/\/$/, "");
const only = process.env.ONLY ? new RegExp(process.env.ONLY, "i") : null;

const NOT_SUBSTACK = /Could not (find|read) an? (Substack )?archive/i;
const EMPTY = /looks empty|no public essays|Paid-only|export/i;
const BAD_URL = /does not look like a publication URL|Paste your publication URL/i;

const rows = [
  ["bare domain", "caithrin.com", "preview"],
  ["https + www + trailing slash", "https://www.caithrin.com/", "preview"],
  ["uppercase", "CAITHRIN.COM", "preview"],
  ["substack.com/@handle", "substack.com/@razib", "preview"],
  ["javascript: scheme", "javascript:alert(1)", BAD_URL],
  ["3,000 characters", "a".repeat(3000) + ".com", /./],
  ["empty submit", "", BAD_URL],
  ["non-Substack (nytimes)", "nytimes.com", NOT_SUBSTACK],
  ["dead domain", "no-such-publication-4f9a1c.com", NOT_SUBSTACK],
  ["platform-leaver (readtangle, Ghost)", "readtangle.com", NOT_SUBSTACK],
  ["apex-only custom domain (ACX, all-infeasible)", "astralcodexten.com", "preview"],
  ["self-redirect apex (generalist)", "generalist.com", EMPTY],
  ["paid-only public side (honestly)", "honestly.substack.com", EMPTY],
  ["recipes (whattocook)", "whattocook.substack.com", "preview"],
  ["poetry (poetryunbound)", "poetryunbound.substack.com", "preview"],
  ["tiny archive (mayacpopa)", "mayacpopa.substack.com", "preview"],
  ["giant daily (statuskuo)", "statuskuo.substack.com", "preview"],
  ["IPv4 literal", "127.0.0.1", BAD_URL],
  ["internal host", "intranet.local", BAD_URL],
  ["unicode domain", "münchen.substack.com", /./],
];

const pw = await import("playwright");
const browser = await pw[engineName].launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e).slice(0, 140)));
await page.goto(base + "/");

let failures = 0;
for (const [name, input, expect] of rows) {
  if (only && !only.test(name)) continue;
  const before = errors.length;
  const t0 = Date.now();
  try {
    await page.fill("#tryurl", input);
    await page.click("#trybtn");
    await page.waitForFunction(() =>
      document.getElementById("preview").classList.contains("personalized") ||
      document.getElementById("tryerr").textContent.length > 3 ||
      document.getElementById("trybtn").disabled === false && document.getElementById("tryerr").textContent.length > 0,
      null, { timeout: 150000 });
    await page.waitForFunction(() => document.getElementById("trybtn").disabled === false, null, { timeout: 150000 });
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => ({
      personalized: document.getElementById("preview").classList.contains("personalized"),
      err: document.getElementById("tryerr").textContent.trim(),
      bookVisible: (() => { const r = document.getElementById("bookwrap").getBoundingClientRect(); return r.width > 50 && r.height > 50; })(),
      handoffShown: !document.getElementById("tryhandoff").hidden,
    }));
    assert.ok(state.bookVisible, "specimen book vanished");
    if (expect === "preview") {
      assert.ok(state.personalized, "expected a personalized preview, got: " + (state.err || "nothing"));
    } else {
      assert.ok(!state.personalized, "expected an honest message, got a personalized preview");
      assert.match(state.err, expect, "message: " + JSON.stringify(state.err));
      if (!BAD_URL.test(state.err)) assert.ok(state.handoffShown, "hand-built offer hidden on failure");
    }
    assert.equal(errors.length, before, "pageerrors: " + errors.slice(before).join(" | "));
    console.log(`PASS ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)${state.personalized ? "" : " :: " + state.err.slice(0, 70)}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name} :: ${String(e.message).slice(0, 200)}`);
  }
}

await browser.close();
console.log(failures ? `INPUT GATE FAILED: ${failures} rows` : `INPUT GATE: ${rows.length} rows passed`);
process.exit(failures ? 1 : 0);
