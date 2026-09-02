#!/usr/bin/env node
// Fault-injection journeys (plan-end-to-end-v1, phase 5). Starts a local Pages server per fault
// with FAULT_SWITCH=1 and asserts what a writer sees. Never runs against production.
// Usage: node scripts/test-faults.mjs   (needs ~/.secrets/inksheaf-relay-token for the relay faults)
import { spawn, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { strict as assert } from "node:assert";

const TOKEN = (() => { try { return readFileSync(`${process.env.HOME}/.secrets/inksheaf-relay-token`, "utf-8").trim(); } catch { return ""; } })();
const PORT = 8791 + Math.floor(Math.random() * 100);
const results = [];
async function withServer(fault, fn) {
  const args = ["wrangler", "pages", "dev", "dist", "--port", String(PORT), "--d1", "DB=inksheaf-beta", "--binding", "FAULT_SWITCH=1", "--binding", `FAULT=${fault}`];
  if (TOKEN) args.push("--binding", `ARCHIVE_RELAY_TOKEN=${TOKEN}`);
  const srv = spawn("npx", args, { stdio: ["ignore", "pipe", "pipe"] });
  let ready = false; srv.stdout.on("data", d => { if (/Ready on/.test(String(d))) ready = true; }); srv.stderr.on("data", () => {});
  const t0 = Date.now(); while (!ready && Date.now() - t0 < 60000) await new Promise(r => setTimeout(r, 500));
  if (!ready) throw new Error("server did not start");
  try { await fn(`http://localhost:${PORT}`); } finally { srv.kill("SIGTERM"); await new Promise(r => setTimeout(r, 800)); }
}
async function paste(base, host, timeout = 70000) {
  const b = await chromium.launch(); const page = await b.newPage();
  const t0 = Date.now();
  await page.goto(`${base}/?pub=${host}`);
  await page.waitForFunction(() => document.getElementById("preview").classList.contains("personalized") || document.getElementById("tryerr").textContent.trim().length > 3, null, { timeout });
  const r = await page.evaluate(() => ({ personalized: document.getElementById("preview").classList.contains("personalized"), err: document.getElementById("tryerr").textContent.trim(), handoff: !document.getElementById("tryhandoff").hidden, by: (document.getElementById("plan-by") || {}).textContent || "" }));
  await b.close(); return { ...r, ms: Date.now() - t0 };
}
function row(name, cond, note) { results.push({ name, ok: !!cond, note }); console.log(`${cond ? "PASS" : "FAIL"} ${name}${note ? " :: " + note : ""}`); }

execSync("npx astro build", { stdio: "ignore" });
await withServer("direct_fail", async base => {
  const r = await paste(base, "caithrin.com");
  row("direct fails: the relay still builds the book", r.personalized, r.err || `${r.ms} ms`);
});
await withServer("relay_fail", async base => {
  const r = await paste(base, "heathercoxrichardson.substack.com", 90000);
  /* HCR's direct read is capped; the handoff fails; the writer still gets a book from what was read */
  row("relay fails on a big archive: a capped book, not an error", r.personalized, r.err || `${r.ms} ms`);
});
await withServer("relay_slow", async base => {
  const r = await paste(base, "heathercoxrichardson.substack.com", 90000);
  row("relay slow: the page answers inside its budget", r.personalized || /did not answer|taking too long/.test(r.err), `${r.ms} ms ${r.err}`);
});
await withServer("editor_fail", async base => {
  const r = await paste(base, "caithrin.com");
  await new Promise(res => setTimeout(res, 6000));
  row("editor fails: the calendar plan stays and says so", r.personalized, r.by);
});
const failed = results.filter(x => !x.ok).length;
console.log(`FAULT GATE: ${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
