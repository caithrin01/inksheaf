#!/usr/bin/env node
// The Lulu listing (plan-end-to-end-v1, phase 3). Lulu has no publishing API; the wizard at
// lulu.com is the only path. This script drives it with a saved login session.
//
// Wizard map, read from the live wizard on 2026-09-02 (logged in, nothing created):
//   /account/wizard/draft/start    product type (Print Book) · goal (Publish Your Book) ·
//                                  project title · language · category
//   /account/wizard/<id>/copyright copyright holder, licence
//   /account/wizard/<id>/design    interior PDF upload, specs (US Trade 6x9, B&W or colour,
//                                  60# white uncoated, perfect bound, matte), cover PDF upload
//   /account/wizard/<id>/details   description, keywords, contributors, ISBN choice
//   /account/wizard/<id>/pricing   list price (floor = print cost), payee (required even at $0)
//   /account/wizard/<id>/review    review, publish, then access level (Select Access)
//
// Modes:
//   --explore            open each step, save a screenshot and the interactive tree to
//                        evidence/lulu-wizard/, stop before anything is created
//   --run <manifest>     drive the wizard from a press manifest (list.json); stops before
//                        Publish unless --publish is given, and records the product URL
// Session: ~/.secrets/lulu-session.json, made once by `--login` (headed browser, a person
// signs in, the storage state is saved outside the vault and the repo).
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const SESSION = `${process.env.HOME}/.secrets/lulu-session.json`;
const OUT = process.env.LULU_WIZARD_EVIDENCE || `${process.env.HOME}/Library/Mobile Documents/com~apple~CloudDocs/Caithrin/05-Projects/Substack Magazine/evidence/lulu-wizard`;
const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const has = f => process.argv.includes(f);

if (has("--login")) {
  const b = await chromium.launch({ headless: false });
  const ctx = await b.newContext();
  const page = await ctx.newPage();
  await page.goto("https://www.lulu.com/account/projects");
  console.error("Sign in to Lulu in the window, open My Projects, then press Enter here.");
  await new Promise(r => process.stdin.once("data", r));
  await ctx.storageState({ path: SESSION });
  await b.close();
  console.log(`session saved to ${SESSION}`);
  process.exit(0);
}
if (!existsSync(SESSION)) { console.error(`no session at ${SESSION}; run with --login first`); process.exit(2); }

const b = await chromium.launch({ headless: !has("--headed") });
const ctx = await b.newContext({ storageState: SESSION, viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
async function snapshot(name) {
  await page.screenshot({ path: `${OUT}/${stamp}-${name}.png`, fullPage: true });
  const tree = await page.evaluate(() => [...document.querySelectorAll("a,button,input,select,textarea,[role=radio],[role=checkbox],[role=tab]")]
    .map(e => ({ tag: e.tagName.toLowerCase(), type: e.type || null, name: e.name || null, id: e.id || null, text: (e.innerText || e.value || e.getAttribute("aria-label") || "").trim().slice(0, 80), href: e.getAttribute("href"), testid: e.getAttribute("data-testid") || e.getAttribute("data-test") || null }))
    .filter(e => e.text || e.name || e.id || e.testid));
  writeFileSync(`${OUT}/${stamp}-${name}.json`, JSON.stringify(tree, null, 1));
  console.log(`${name}: ${tree.length} controls -> ${OUT}/${stamp}-${name}.{png,json}`);
}

try {
  await page.goto("https://www.lulu.com/account/projects", { waitUntil: "networkidle" });
  if (!(await page.getByText("Projects Overview").count())) throw new Error("not signed in; run --login again");
  if (has("--explore")) {
    await snapshot("projects");
    await page.goto("https://www.lulu.com/account/wizard/draft/start", { waitUntil: "networkidle" });
    await snapshot("start");
    console.log("explore stops here: the next step creates a draft project on the account");
  } else if (arg("--run")) {
    const manifest = JSON.parse(readFileSync(arg("--run"), "utf-8"));
    /* The run is written step by step against the trees --explore records; each step asserts
       the page it expects before acting, and the last action before Publish is a review
       screenshot. Not yet driven end to end: see the plan's phase 3 log. */
    console.error("run mode: selectors for the design, details and pricing steps are recorded by --explore on a draft that a person starts; not yet implemented");
    console.error(`manifest: ${manifest.host}, ${manifest.built?.length || 0} volume(s)`);
    process.exitCode = 3;
  } else {
    console.error("usage: lulu-list.mjs --login | --explore | --run list.json [--publish] [--headed]");
    process.exitCode = 2;
  }
} finally { await b.close(); }
