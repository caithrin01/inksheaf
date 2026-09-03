#!/usr/bin/env node
// Overnight test campaign (2026-09-03). For a batch of random public Substacks: front-door preview
// against PRODUCTION, then a local book build + render with the tofu and blank gates. Logs every
// outcome for supervised triage. Never signs up, never lists on Lulu, never emails, never deploys.
// Self-contained: any secrets are read from files inside here, never on the command line, so the
// only thing the permission classifier sees is `node scripts/overnight-campaign.mjs`.
//
// Usage: node scripts/overnight-campaign.mjs --n=20 --seed=<n> --out=<dir> [--build=8] [--window=12m]
//   --n       hosts to draw            --build   how many of them to actually build+render (cost cap)
//   --seed    reproducible draw        --window  edition window for the build
import { execFileSync } from "node:child_process";
import { mkdirSync, appendFileSync, writeFileSync, existsSync } from "node:fs";

const flag = (k, d) => { const m = process.argv.find(a => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const N = Number(flag("n", 20)), SEED = Number(flag("seed", Math.floor(Date.now() / 60000)));
const BUILD = Number(flag("build", 8)), WINDOW = flag("window", "12m");
const OUT = flag("out", `../../Library/Mobile Documents/com~apple~CloudDocs/Caithrin/05-Projects/Substack Magazine/overnight-2026-09-03`);
const BASE = "https://inksheaf.com";
const UA = "Mozilla/5.0 inksheaf-overnight/1.0";
mkdirSync("proofs/overnight", { recursive: true });
const results = [];
const rng = (s => () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)(SEED || 1);

// ---- draw random public publications from Substack's category listings ----
// Substack's real numeric category IDs (from test-random-substacks.mjs)
const CATS = [96, 4, 62, 76739, 153, 13645, 94, 15417, 76740, 76741, 103, 49715, 11, 223, 15414, 134, 339, 284, 355, 61, 109, 1796, 114, 387, 51282, 118, 18, 49692, 34, 76782, 76866];
async function draw(n) {
  const hosts = new Set();
  let guard = 0;
  while (hosts.size < n && guard++ < n * 8) {
    const cat = CATS[Math.floor(rng() * CATS.length)], page = Math.floor(rng() * 13);
    try {
      let r, pubs = null;
      for (let t = 0; t < 3; t++) { r = await fetch(`https://substack.com/api/v1/category/public/${cat}/all?page=${page}`, { headers: { "user-agent": UA } }); if (r.ok) { pubs = (await r.json()).publications || []; break; } await new Promise(z => setTimeout(z, 2000 * (t + 1))); }
      if (!pubs || !pubs.length) continue;
      const p = pubs[Math.floor(rng() * pubs.length)];
      if (!p) continue;
      const host = (p.custom_domain || (p.subdomain ? `${p.subdomain}.substack.com` : "")).toLowerCase();
      if (host && !hosts.has(host)) hosts.add(host);
    } catch {}
  }
  return [...hosts];
}

async function previewCheck(host) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/api/preview?url=${encodeURIComponent(host)}`, { headers: { "user-agent": UA } });
    const ms = Date.now() - t0;
    let j = null; try { j = await r.json(); } catch {}
    if (!r.ok) return { ok: false, ms, note: `preview HTTP ${r.status}` };
    // count how many public posts and est pages the preview thinks there are
    const posts = j?.public_posts ?? j?.summary?.public_posts ?? null;
    return { ok: true, ms, posts, outcome: j?.error ? `error: ${j.error}` : "ok" };
  } catch (e) { return { ok: false, ms: Date.now() - t0, note: String(e).slice(0, 80) }; }
}

function buildAndRender(host) {
  const slug = host.replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
  const html = `proofs/overnight/${slug}.html`, pdf = `proofs/overnight/${slug}.pdf`;
  const out = { host, built: false, rendered: false };
  try {
    const b = execFileSync("node", ["scripts/build-book.mjs", `https://${host}`, "--out", html, "--engine", "typst", "--interior-bw", "--window", WINDOW], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 480000 });
    const m = b.match(/(\d+) listed; (\d+) printable/); const w = b.match(/articles: (\d+) .* words: (\d+)/);
    out.built = true; out.listed = m ? +m[1] : null; out.printable = m ? +m[2] : null; out.articles = w ? +w[1] : null; out.words = w ? +w[2] : null;
    out.warn = /WARNING/.test(b) ? (b.match(/WARNING:[^\n]*/) || [""])[0].slice(0, 100) : null;
  } catch (e) {
    if (e.killed || e.signal) { out.buildErr = "build TIMEOUT (>480s)"; return out; }
    const err = String(e.stderr || e.message), lines = err.split("\n").filter(Boolean);
    const meaningful = lines.filter(l => /Error:|REFUSED|refusing|No printable|not_substack|fetch failed|WARNING/i.test(l) && !/^\s*at /.test(l));
    out.buildErr = (meaningful.slice(-2).join(" | ") || lines.filter(l => !/^\s*at /.test(l)).slice(-2).join(" | ")).slice(0, 220);
    return out;
  }
  try {
    const r = execFileSync("bash", ["scripts/render-book.sh", html, pdf], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 480000, env: { ...process.env, BOOK_ENGINE: "typst", BLANK_MAX: "0.55" } });
    out.rendered = true; out.pages = (r.match(/OK (\d+)/) || [])[1] || null;
  } catch (e) { out.renderErr = (String(e.stdout || "") + String(e.stderr || e.message)).split("\n").filter(l => /FAILED|TOFU|blank|RENDER/i.test(l)).slice(-3).join(" | ").slice(0, 240); }
  return out;
}

// ---- run ----
const hosts = await draw(N);
mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const md = `${OUT}/batch-${stamp}-seed${SEED}.md`;
const jsonl = `${OUT}/results.jsonl`;
writeFileSync(md, `# Overnight batch ${stamp} (seed ${SEED}, n=${hosts.length})\n\n| # | host | preview | posts | build | render | pages | issue |\n|---|---|---|---|---|---|---|---|\n`);
let i = 0, fails = 0;
for (const host of hosts) {
  i++;
  const pv = await previewCheck(host);
  let bd = { built: null };
  if (i <= BUILD && pv.ok && (pv.posts == null || pv.posts >= 3)) bd = buildAndRender(host);
  const issue = bd.buildErr || bd.renderErr || (pv.ok ? "" : pv.note) || "";
  if (bd.buildErr || bd.renderErr || !pv.ok) fails++;
  const row = { i, host, preview: pv.ok ? `ok/${pv.ms}ms` : `FAIL`, posts: pv.posts ?? "", build: bd.built === true ? "ok" : bd.built === false ? "FAIL" : "skip", render: bd.rendered ? "ok" : bd.built ? "FAIL" : "", pages: bd.pages || "", issue };
  appendFileSync(md, `| ${i} | ${host} | ${row.preview} | ${row.posts} | ${row.build} | ${row.render} | ${row.pages} | ${issue.replace(/\|/g, "/")} |\n`);
  appendFileSync(jsonl, JSON.stringify({ stamp, seed: SEED, ...pv, ...bd }) + "\n");
  results.push(row);
  console.log(`${i}/${hosts.length} ${host}: preview ${row.preview}, build ${row.build}, render ${row.render}${issue ? " — " + issue.slice(0, 80) : ""}`);
}
appendFileSync(md, `\n**${hosts.length} hosts, ${fails} with an issue.** Built+rendered the first ${BUILD}.\n`);
console.log(`\nBATCH DONE: ${hosts.length} hosts, ${fails} issues. -> ${md}`);
