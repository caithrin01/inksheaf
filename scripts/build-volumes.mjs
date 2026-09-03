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
import { mkdirSync, writeFileSync } from "node:fs";
import { planDivisions } from "../functions/lib/preview-summary.js";
import { fit } from "./lib/fit.mjs";

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
process.env.BOOK_ENGINE = ENGINE;  // render-book.sh (inside fit) selects typst from this
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


const MIN_PP = 32, MAX_PP = 330;  // print range: 32pp perfect-bound floor, ~300 target plus margin

// ---- seed windows: finest cadence the estimate calls feasible; else the densest grid available.
// Measurement + date-splitting refines from here, so a "fat" seed month is fine as a starting grid.
const div = planDivisions(publicPosts, estPages);
const seeds = (div.single.feasible ? div.single.volumes
  : div.quarterly.feasible ? div.quarterly.volumes
  : div.monthly.volumes).map(v => ({ from: v.from, to: v.to }));
console.error(`seed grid: ${seeds.length} window(s); rendering, measuring, and re-splitting to keep every volume ${MIN_PP}-${MAX_PP}pp`);

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function spanLabelOf(posts) {
  const a = new Date(posts[0].post_date), b = new Date(posts[posts.length - 1].post_date);
  const am = MONTHS[a.getUTCMonth()] + " " + a.getUTCFullYear(), bm = MONTHS[b.getUTCMonth()] + " " + b.getUTCFullYear();
  return am === bm ? am : am + " – " + bm;
}
const day = d => String(d).slice(0, 10);
const postsIn = (from, to) => publicPosts
  .filter(p => day(p.post_date) >= from && day(p.post_date) <= to)
  .sort((a, b) => Date.parse(a.post_date) - Date.parse(b.post_date));

let renderCount = 0;
function renderWindow(from, to, label) {
  const tag = `${from}_${to}`.replace(/-/g, "");
  const html = `${OUTDIR}/${slug}-${tag}.html`, pdf = `${OUTDIR}/${slug}-${tag}.pdf`;
  const args = ["scripts/build-book.mjs", url, "--out", html, "--engine", ENGINE];
  if (BW) args.push("--interior-bw");
  args.push("--after", from, "--before", to, "--vol-label", label);
  renderCount++;
  if (!RENDER) {
    try { execFileSync("node", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 600000 }); return { built: true, html, pdf }; }
    catch (e) { return { built: false, err: String(e.stderr || e.message).split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 140), html, pdf }; }
  }
  try {
    const res = fit({ args, html, pdf: `${process.cwd()}/${pdf}`, log: () => {}, passes: 6 });
    return { built: true, pages: +((String(res.out || "").match(/OK (\d+)/) || [])[1] || 0), ok: res.ok, html, pdf };
  } catch (e) { return { built: false, err: String(e.message).split("\n").slice(-1)[0]?.slice(0, 140), html, pdf }; }
}
// a day boundary nearest the middle, so the two halves do not share a date (build-book windows are day-inclusive)
function splitAt(posts) {
  const mid = Math.floor((posts.length - 1) / 2);
  for (let d = 0; d < posts.length; d++)
    for (const k of [mid - d, mid + d])
      if (k >= 0 && k < posts.length - 1 && day(posts[k].post_date) < day(posts[k + 1].post_date))
        return [day(posts[k].post_date), day(posts[k + 1].post_date)];
  return null; // every post on one day: cannot split by date
}

// ---- measure and re-split ----
const queue = [...seeds];
const final = [];
let guard = 0;
while (queue.length && guard++ < 300) {
  const w = queue.shift();
  const posts = postsIn(w.from, w.to);
  if (!posts.length) continue;
  const label = spanLabelOf(posts);
  const r = renderWindow(w.from, w.to, label);
  if (!r.built) { final.push({ ...w, label, posts: posts.length, status: "BUILD/RENDER FAIL", err: r.err }); console.error(`  ${label}: FAIL — ${r.err || ""}`); continue; }
  if (RENDER && r.pages > MAX_PP && posts.length > 1) {
    const cut = splitAt(posts);
    if (cut) { console.error(`  ${label} rendered ${r.pages}pp (>${MAX_PP}); split at ${cut[0]}|${cut[1]}`); queue.unshift({ from: w.from, to: cut[0] }, { from: cut[1], to: w.to }); continue; }
  }
  const over = RENDER && r.pages > MAX_PP;
  final.push({ ...w, label, posts: posts.length, pages: r.pages || null, ok: !!r.ok, over, pdf: r.pdf, status: !RENDER ? "built" : over ? "over (atomic)" : r.ok ? "clean" : "render?" });
  console.error(`  ${label}: ${final[final.length - 1].status}${r.pages ? " " + r.pages + "pp" : ""}${over ? " (single essay past target, kept)" : ""}`);
}

final.sort((a, b) => (a.from < b.from ? -1 : 1));
const roman = n => ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX","XXI","XXII","XXIII","XXIV"][n - 1] || String(n);
const cleanN = final.filter(f => f.ok && !f.over).length;
console.log(`\n${host} - ${final.length} volume(s) from ${renderCount} render(s), ${cleanN} clean and in range:`);
final.forEach((f, i) => console.log(`  Vol ${roman(i + 1)} ${f.label} [${f.from}..${f.to}] ${f.posts} posts -> ${f.status}${f.pages ? " " + f.pages + "pp" : ""}`));
const outrange = final.filter(f => f.over || !f.ok);
if (outrange.length) console.log(`\n${outrange.length} volume(s) need attention: ${outrange.map(f => `${f.label} (${f.status})`).join(", ")}`);

// retained page rasters as visual evidence (codex step 2): a few pages per clean volume
const rasterDir = `${OUTDIR}/rasters`;
if (RENDER) mkdirSync(rasterDir, { recursive: true });
for (const f of final) {
  f.rasters = [];
  if (!RENDER || !f.pdf || !f.pages) continue;
  const n = f.pages, want = [1, Math.max(2, Math.round(n * 0.25)), Math.round(n * 0.5), Math.round(n * 0.75)].filter((v, i, a) => a.indexOf(v) === i && v <= n);
  const stem = `${rasterDir}/${(f.pdf.split("/").pop() || "vol").replace(/\.pdf$/, "")}`;
  for (const pg of want) {
    try { execFileSync("pdftoppm", ["-f", String(pg), "-l", String(pg), "-r", "70", "-png", f.pdf, `${stem}-p${pg}`], { stdio: "ignore", timeout: 60000 });
      // pdftoppm names files with zero-padded page numbers; find the produced file
      const { readdirSync } = await import("node:fs");
      const base = stem.split("/").pop() + `-p${pg}`;
      const hit = readdirSync(rasterDir).find(x => x.startsWith(base) && x.endsWith(".png"));
      if (hit) f.rasters.push(`rasters/${hit}`);
    } catch {}
  }
}
console.log(`rasters: ${final.reduce((a, f) => a + (f.rasters ? f.rasters.length : 0), 0)} page image(s) under ${rasterDir}`);

// machine-readable evidence (codex step 2)
const manifest = { host, url, window: WINDOW, generated: new Date().toISOString(), renders: renderCount,
  range: { min: MIN_PP, max: MAX_PP },
  volumes: final.map((f, i) => ({ n: i + 1, roman: roman(i + 1), label: f.label, from: f.from, to: f.to,
    posts: f.posts, pages: f.pages || null, clean: !!f.ok, in_range: !!f.pages && f.pages >= MIN_PP && f.pages <= MAX_PP,
    status: f.status, pdf: f.pdf ? f.pdf.split("/").pop() : null, rasters: f.rasters || [] })) };
writeFileSync(`${OUTDIR}/volumes.json`, JSON.stringify(manifest, null, 2));
console.log(`\nmanifest: ${OUTDIR}/volumes.json`);
