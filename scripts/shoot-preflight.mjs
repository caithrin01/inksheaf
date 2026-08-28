#!/usr/bin/env node
// Verification gate for teaser assets (plan: "every asset exists at exact spec... contact
// sheet PNG generated for a one-glance human review"). Exits nonzero on any missing/undersized
// asset. Montage written to assets/contact-sheet.png.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

const REQUIRED = {
  // name: [minWidth, minHeight]
  "site-hero-light": [3840, 2160], "site-hero-dark": [3840, 2160],
  "preview-1-empty": [3840, 2160], "preview-2-typed": [3840, 2160],
  "preview-3-typesetting": [3840, 2160], "preview-4-result": [3840, 2160],
  "funnel-step2": [3840, 2160],
  "obj-book-branded": [400, 600], "obj-contents-page": [300, 450], "obj-bookstage": [800, 500],
  "site-hero-vert": [1214, 2160], "preview-result-vert": [1214, 2160],
  "cover-caithrin": [1700, 2600], "cover-caithrin-selected": [1700, 2600],
  "cover-hcr": [1700, 2600], "cover-razib": [1700, 2600], "cover-slowboring": [1700, 2600],
  "spread-toc": [3600, 2600], "spread-opener": [3600, 2600],
  "impose-booklet-sheet1": [3400, 2600], "impose-spread-mid": [3400, 2600],
  "econ-card": [3840, 2160], "terminal-card": [3840, 2160],
};

let fail = 0;
const rows = [];
for (const [name, [mw, mh]] of Object.entries(REQUIRED)) {
  const f = `assets/shots/${name}.png`;
  if (!existsSync(f)) { console.error(`MISSING ${name}`); fail++; continue; }
  const [w, h] = execFileSync("magick", ["identify", "-format", "%w %h", f]).toString().split(" ").map(Number);
  const ok = w >= mw && h >= mh;
  if (!ok) { console.error(`UNDERSIZED ${name}: ${w}x${h} < ${mw}x${mh}`); fail++; }
  rows.push(`${ok ? "ok  " : "BAD "} ${name} ${w}x${h}`);
}
console.log(rows.join("\n"));

// contact sheet: everything in shots/, labeled
const all = readdirSync("assets/shots").filter(f => f.endsWith(".png")).sort().map(f => `assets/shots/${f}`);
execFileSync("montage", ["-font", "/System/Library/Fonts/Supplemental/Arial.ttf",
  ...all, "-label", "%t", "-tile", "5x", "-geometry", "460x300+12+12",
  "-background", "#efe8d8", "-fill", "#221d16", "-pointsize", "13", "assets/contact-sheet.png"]);
console.log(`\ncontact sheet: ${all.length} assets -> assets/contact-sheet.png`);
if (fail) { console.error(`\nPREFLIGHT FAIL: ${fail} problem(s)`); process.exit(1); }
console.log("PREFLIGHT PASS");
