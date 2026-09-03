#!/usr/bin/env node
// Build a prolific publication as a SET of volumes instead of refusing it (fixes the #2 overnight
// offender: oversized archives). Fetches the archive, reuses the site preview's planDivisions to
// choose a cadence (single -> quarterly -> monthly), then runs build-book + render-book once per
// volume with --after/--before date windows and --vol-label/--vol-of naming. Declines honestly
// ("concierge") only when even a monthly split leaves a volume over the 300pp cap.
//
// Usage: node scripts/build-volumes.mjs <url> --out-dir proofs/vol/<slug> [--window 24m|all]
//                                       [--engine typst] [--interior-bw] [--render]
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { planDivisions } from "../functions/lib/preview-summary.js";

const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true) : d; };
const url = argv.find(a => /^https?:\/\//.test(a));
if (!url) { console.error("usage: build-volumes.mjs <url> --out-dir <dir> [--window 24m|all] [--engine typst] [--interior-bw] [--render]"); process.exit(1); }
const host = new URL(url).host.toLowerCase();
const slug = host.replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
const OUTDIR = flag("out-dir", `proofs/vol/${slug}`);
const WINDOW = flag("window", "all");
const ENGINE = flag("engine", "typst");
const BW = argv.includes("--interior-bw");
const RENDER = argv.includes("--render");
const UA = { "user-agent": "Mozilla/5.0 inksheaf-volumes/1.0" };
mkdirSync(OUTDIR, { recursive: true });

// window cutoff (Nm = N months back; "all" = no cutoff)
let cutoff = 0;
const wm = String(WINDOW).match(/^(\d+)m$/);
if (wm) { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - Number(wm[1])); cutoff = d.getTime(); }

// ---- fetch archive listing (same endpoint/shape build-book uses) ----
async function j(u) { const r = await fetch(u, { headers: UA, redirect: "follow" }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); }
const listing = [];
for (let offset = 0; ; offset += 25) {
  let page; try { page = await j(`https://${host}/api/v1/archive?sort=new&offset=${offset}&limit=25`); } catch (e) { if (offset === 0) { console.error("archive fetch failed:", e.message); process.exit(1); } break; }
  if (!page.length) break;
  listing.push(...page);
  const oldest = page[page.length - 1]?.post_date;
  if (cutoff && oldest && Date.parse(oldest) < cutoff) break;
  if (listing.length > 1800) break;
}
const publicPosts = listing.filter(p => (!p.audience || p.audience === "everyone") && (p.type === "newsletter" || !p.type)
  && (!cutoff || Date.parse(p.post_date) >= cutoff) && p.post_date);
if (publicPosts.length < 1) { console.error("no public posts in window"); process.exit(3); }
const estWords = publicPosts.reduce((a, p) => a + (Number(p.wordcount) || 0), 0);
const estPages = Math.round(estWords / 270 + publicPosts.length + 10);
console.error(`${host}: ${publicPosts.length} public posts in window (${WINDOW}), ~${estPages}pp whole`);

// ---- choose cadence ----
const div = planDivisions(publicPosts, estPages);
let cadence, volumes;
if (div.single.feasible) { cadence = "single"; volumes = div.single.volumes; }
else if (div.quarterly.feasible) { cadence = "quarterly"; volumes = div.quarterly.volumes; }
else if (div.monthly.feasible) { cadence = "monthly"; volumes = div.monthly.volumes; }
else {
  console.error(`CONCIERGE: cannot bind under 300pp even monthly. quarterly: ${div.quarterly.reason}; monthly: ${div.monthly.reason}`);
  console.error("A book this dense needs a hand-picked selection or a per-issue plan; declined automatically.");
  process.exit(4);
}
console.error(`cadence: ${cadence} -> ${volumes.length} volume(s)`);

// ---- build (and optionally render) each volume ----
const rows = [];
const N = volumes.length;
const roman = n => ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX"][n - 1] || String(n);
for (let i = 0; i < N; i++) {
  const v = volumes[i];
  const vslug = `${slug}-v${i + 1}`;
  const html = `${OUTDIR}/${vslug}.html`, pdf = `${OUTDIR}/${vslug}.pdf`;
  const volOf = N > 1 ? `${roman(i + 1)} of ${roman(N)}` : "";
  const args = [url, "--out", html, "--engine", ENGINE];
  if (BW) args.push("--interior-bw");
  if (cadence !== "single") args.push("--after", v.from, "--before", v.to, "--vol-label", v.label);
  if (volOf) args.push("--vol-of", volOf);
  const row = { vol: i + 1, label: v.label, window: cadence === "single" ? "(whole)" : `${v.from}..${v.to}`, est: v.est_pages, pages: "", status: "" };
  try {
    const b = execFileSync("node", ["scripts/build-book.mjs", ...args], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 600000 });
    row.status = "built";
    if (RENDER) {
      try {
        const r = execFileSync("bash", ["scripts/render-book.sh", html, pdf], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 600000, env: { ...process.env, BOOK_ENGINE: ENGINE, BLANK_MAX: "0.55" } });
        row.pages = (r.match(/OK (\d+)/) || [])[1] || "";
        row.status = row.pages ? "rendered" : "render?";
      } catch (e) { row.status = "RENDER FAIL"; row.err = (String(e.stdout || "") + String(e.stderr || e.message)).split("\n").filter(l => /FAIL|TOFU|blank|RENDER/i.test(l)).slice(-2).join(" | ").slice(0, 160); }
    }
  } catch (e) { row.status = "BUILD FAIL"; row.err = String(e.stderr || e.message).split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 160); }
  rows.push(row);
  console.error(`vol ${i + 1}/${N} ${v.label}: ${row.status}${row.pages ? " " + row.pages + "pp" : ""}${row.err ? " — " + row.err : ""}`);
}
console.log(`\n${host} — ${cadence}, ${N} volume(s):`);
for (const r of rows) console.log(`  Vol ${r.vol} ${r.label} [${r.window}] est ${r.est}pp -> ${r.status}${r.pages ? " " + r.pages + "pp" : ""}`);
