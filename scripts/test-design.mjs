#!/usr/bin/env node
// Design gate (launch-hardening 2.2, automated half). Three page states (specimen,
// personalized with caithrin.com, error with nytimes.com) in light and dark:
//   - axe-core WCAG 2 AA run at 1440 and 390 wide; zero color-contrast violations is the
//     pass condition, every other violation is printed and counted but does not fail
//     (the person's read at the freeze decides those).
//   - the screenshot set: 5 viewports (390, 768, 1024, 1440, 2560) x 2 schemes x 3 states
//     = 30 full-page JPEGs written to <evidence>/shots/<head>/, for the checklist read.
// Usage: node scripts/test-design.mjs [base-url]   (default https://inksheaf.com)
// Evidence dir: INKSHEAF_EVIDENCE_DIR or the vault's Substack Magazine/evidence folder.
import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const base = (process.argv[2] || "https://inksheaf.com").replace(/\/$/, "");
/* ship.sh runs from a frozen export without .git and passes INKSHEAF_HEAD instead */
const head = process.env.INKSHEAF_HEAD ||
  (() => { try { return execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return "nohead"; } })();
const evidenceDir = process.env.INKSHEAF_EVIDENCE_DIR ||
  `${process.env.HOME}/Library/Mobile Documents/com~apple~CloudDocs/Caithrin/05-Projects/Substack Magazine/evidence`;
const shotDir = join(evidenceDir, "shots", head);
mkdirSync(shotDir, { recursive: true });
const axeSource = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");

const WIDTHS = [390, 768, 1024, 1440, 2560];
const AXE_WIDTHS = [1440, 390];
const STATES = {
  specimen: null,
  personalized: "caithrin.com",
  error: "nytimes.com",
};

const pw = await import("playwright");
const browser = await pw.chromium.launch();
let failures = 0, shots = 0, otherViolations = 0;
const rows = [];

async function reach(page, state) {
  await page.goto(base + "/", { waitUntil: "networkidle" });
  const url = STATES[state];
  if (!url) return;
  await page.fill("#tryurl", url);
  await page.click("#trybtn");
  await page.waitForFunction(() =>
    document.getElementById("preview").classList.contains("personalized") ||
    document.getElementById("tryerr").textContent.length > 3, null, { timeout: 150000 });
  await page.waitForTimeout(1200);
  const personalized = await page.evaluate(() => document.getElementById("preview").classList.contains("personalized"));
  assert.equal(personalized, state === "personalized", `${state}: page reached the wrong state`);
}

for (const scheme of ["light", "dark"]) {
  for (const state of Object.keys(STATES)) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: scheme });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(String(e).slice(0, 140)));
    try {
      await reach(page, state);
      for (const w of WIDTHS) {
        await page.setViewportSize({ width: w, height: w < 800 ? 844 : 950 });
        await page.waitForTimeout(350);
        const file = join(shotDir, `${state}-${scheme}-${w}.jpg`);
        await page.screenshot({ path: file, fullPage: true, type: "jpeg", quality: 82 });
        shots++;
      }
      for (const w of AXE_WIDTHS) {
        await page.setViewportSize({ width: w, height: w < 800 ? 844 : 950 });
        await page.waitForTimeout(350);
        await page.addScriptTag({ content: axeSource });
        /* .nm-btn is excluded: it depicts Substack's own post button (white on #ff6719, 2.9:1)
           inside the figure labelled as an example of a Substack post. The colour is theirs. */
        const result = await page.evaluate(async () =>
          await window.axe.run({ exclude: [[".nm-btn"]] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }));
        const contrast = result.violations.filter(v => v.id === "color-contrast");
        const other = result.violations.filter(v => v.id !== "color-contrast");
        otherViolations += other.length;
        for (const v of other)
          console.log(`  note ${state}/${scheme}/${w}: ${v.id} (${v.impact}) x${v.nodes.length}: ${v.help}`);
        const detail = contrast.flatMap(v => v.nodes.map(n => n.target.join(" ") + " " + (n.any[0]?.message || "")))
          .slice(0, 6).join(" | ");
        rows.push({ state, scheme, width: w, contrast: contrast.reduce((s, v) => s + v.nodes.length, 0), other: other.length });
        assert.equal(contrast.length, 0, `${state}/${scheme}/${w}: color-contrast violations: ${detail}`);
      }
      assert.equal(errors.length, 0, "pageerrors: " + errors.join(" | "));
      console.log(`PASS ${state} ${scheme}: ${WIDTHS.length} shots, axe contrast clean at ${AXE_WIDTHS.join("/")}`);
    } catch (e) {
      failures++;
      console.log(`FAIL ${state} ${scheme} :: ${String(e.message).slice(0, 220)}`);
    } finally { await ctx.close(); }
  }
}
await browser.close();

console.log(`\n| state | scheme | width | contrast nodes | other violations |\n|---|---|---|---|---|`);
for (const r of rows) console.log(`| ${r.state} | ${r.scheme} | ${r.width} | ${r.contrast} | ${r.other} |`);
console.log(`\n${shots} screenshots in ${shotDir}`);
console.log(failures ? `DESIGN GATE FAILED: ${failures} state(s)` : `DESIGN GATE: 6 states clean, ${otherViolations} non-contrast notes for the read`);
process.exit(failures ? 1 : 0);
