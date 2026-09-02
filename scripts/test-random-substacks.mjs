#!/usr/bin/env node
// Random-publication battery (2026-09-01, after the understandingai incident). Every other
// suite runs on hosts chosen by the person who wrote the code. This one draws publications
// at random from Substack's public category listings (31 categories, pages 0 to 12, one
// pick per draw, seeded so a run can be repeated), pastes each into the real page the way
// a writer would (three URL forms), and judges the outcome against an independent read of
// the same archive made from this machine with the same summariser.
//
// Verdicts per publication:
//   PASS      the page's outcome and numbers agree with the independent read
//   DEGRADED  a live archive got the outage message (retry + hand-built) instead of a book
//   FAIL      a live archive was called "check the address", the numbers disagree, the page
//             threw, the page gave up without a message, or the answer took over 45s
//   UNKNOWN   the independent read could not reach the archive; the page outcome is recorded
// The run fails on any FAIL, on more than 10% DEGRADED, or on p95 over 45s. It always
// prints a "not covered" list. Writes evidence/random/<date>-seed<seed>-<engine>-<base>.md.
//
// Usage: node scripts/test-random-substacks.mjs [chromium|webkit|firefox] [base] [--n=30] [--seed=N]
import { chromium, webkit, firefox } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { summarizeArchive } from "../functions/lib/preview-summary.js";

const engineName = process.argv[2] || "chromium";
const base = (process.argv[3] || "https://inksheaf.com").replace(/\/$/, "");
const flag = (k, d) => { const m = process.argv.find(a => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const N = Number(flag("n", 30));
const SEED = Number(flag("seed", Math.floor(Date.now() / 60000)));
const PER_PUB_MS = 50000;
const WINDOW_DAYS = 366;
const MAX_POSTS = 150;
const UA = "Mozilla/5.0 (Macintosh) inksheaf-random-battery/1.0 (+https://inksheaf.com)";

/* mulberry32: a seeded generator so the draw is repeatable but not chosen by me */
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = rng(SEED);
const pick = arr => arr[Math.floor(rand() * arr.length)];

const CATEGORIES = [96, 4, 62, 76739, 153, 13645, 94, 15417, 76740, 76741, 103, 49715, 11, 223, 15414, 134,
  339, 284, 355, 61, 109, 1796, 114, 387, 51282, 118, 18, 49692, 34, 76782, 76866];

async function drawSample(n) {
  const seen = new Set(), out = [];
  let draws = 0;
  while (out.length < n && draws < n * 6) {
    draws++;
    const cat = pick(CATEGORIES), page = Math.floor(rand() * 13);
    let pubs;
    try {
      const r = await fetchWithBackoff(`https://substack.com/api/v1/category/public/${cat}/all?page=${page}`, { headers: { "user-agent": UA } });
      pubs = (await r.json()).publications || [];
    } catch { continue; }
    if (!pubs.length) continue;
    const p = pick(pubs);
    const host = (p.custom_domain || `${p.subdomain}.substack.com`).toLowerCase();
    if (seen.has(host)) continue;
    seen.add(host);
    /* six ways a writer pastes: bare host, the home page, the archive page, a post link,
       shouting caps, and a copy with stray spaces around it */
    const form = pick(["bare", "https", "archive", "post", "upper", "spaces"]);
    const pasted = { bare: host, https: `https://${host}/`, archive: `https://${host}/archive`,
      post: `https://${host}/p/${(pubs[0]?.subdomain || "welcome")}-first-post?utm_source=share`,
      upper: `HTTPS://${host.toUpperCase()}/`, spaces: `  https://${host}  ` }[form];
    out.push({ host, pasted, name: p.name, category: cat, custom: !!p.custom_domain });
  }
  return out;
}

/* Substack answers 429 to a machine that reads too fast; this harness is a reader too.
   Three tries with 4s, 8s and 16s waits, then the caller records the status honestly. */
async function fetchWithBackoff(url, opts) {
  let r;
  for (let i = 0; i < 4; i++) {
    r = await fetch(url, opts);
    if (r.status !== 429) return r;
    await new Promise(res => setTimeout(res, 4000 * 2 ** i));
  }
  return r;
}

/* independent read: the same archive endpoint, from this machine, same paging rule as the API */
async function truthFor(host) {
  const cutoff = Date.now() - WINDOW_DAYS * 86400e3;
  const posts = [];
  let h = host, hops = 0;
  for (let offset = 0; offset < MAX_POSTS; ) {
    let r;
    try {
      r = await fetchWithBackoff(`https://${h}/api/v1/archive?sort=new&offset=${offset}&limit=25`,
        { redirect: "manual", headers: { accept: "application/json", "user-agent": UA }, signal: AbortSignal.timeout(15000) });
    } catch (e) { return { kind: "unknown", detail: String(e?.message || e) }; }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location") || "";
      let next = null; try { next = new URL(loc, `https://${h}`).hostname; } catch {}
      if (next && next !== h && hops < 2) { hops++; h = next; continue; }
      if (!h.startsWith("www.") && hops < 2) { hops++; h = "www." + h; continue; }
      return { kind: "not_substack", detail: `redirect ${loc.slice(0, 60)}` };
    }
    if (r.status === 404 && !h.startsWith("www.") && hops < 2) { hops++; h = "www." + h; continue; }
    if (r.status === 404) return { kind: "not_substack", detail: "404" };
    if (!r.ok) return { kind: "unknown", detail: `status ${r.status}` };
    let page; try { page = await r.json(); } catch { return { kind: "unknown", detail: "bad json" }; }
    if (!Array.isArray(page)) return { kind: "unknown", detail: "not a list" };
    if (!page.length) break;
    posts.push(...page);
    offset += page.length;
    if (Date.parse(page[page.length - 1].post_date || 0) < cutoff) break;
  }
  const identityPost = posts.find(p => p && p.post_date && Date.parse(p.post_date) >= cutoff && (p.type === "newsletter" || !p.type));
  if (!identityPost) return { kind: "empty", detail: `${posts.length} posts read, none in window` };
  const s = summarizeArchive(posts, { publicationName: null, theme: null }, h, cutoff, posts.length >= MAX_POSTS);
  if (!s) return { kind: "empty", detail: "no public posts in window" };
  return { kind: "book", posts: s.posts, words: s.words, est_pages: s.est_pages, capped: posts.length >= MAX_POSTS, host: h };
}

async function drive(page, pasted) {
  const errs = [];
  const onErr = e => errs.push("pageerror: " + String(e).slice(0, 160));
  /* the dev server has no D1, so /api/event answers 500; that is the local setup, not the page */
  const onCon = m => { if (m.type() === "error" && !/api\/(event|signup)/.test((m.location()?.url || "") + m.text())) errs.push("console: " + m.text().slice(0, 160) + " " + (m.location()?.url || "")); };
  page.on("pageerror", onErr); page.on("console", onCon);
  const t0 = Date.now();
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.fill("#tryurl", pasted);
  await page.click("#trybtn");
  await page.waitForFunction(() => document.getElementById("tryerr").textContent.trim() || document.querySelector("#preview.personalized"),
    null, { timeout: PER_PUB_MS }).catch(() => {});
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    err: document.getElementById("tryerr").textContent.trim(),
    handoff: !document.getElementById("tryhandoff").hidden,
    personalized: !!document.querySelector("#preview.personalized"),
    big: document.getElementById("pv-big").textContent.trim(),
    sub: document.getElementById("pv-sub").textContent.trim(),
    verdict: document.getElementById("desk-verdict").textContent.trim(),
    cta: !document.getElementById("pv-cta").hidden && document.getElementById("pv-cta").offsetParent !== null,
    mast: document.getElementById("pv-mast").textContent.trim(),
  }));
  page.off("pageerror", onErr); page.off("console", onCon);
  return { ...r, ms: Date.now() - t0, errs };
}

function judge(truth, r) {
  const notes = [];
  if (r.errs.length) return { verdict: "FAIL", note: r.errs[0] };
  if (r.ms > 45000 && !r.personalized && !r.err) return { verdict: "FAIL", note: "no answer inside 45s" };
  const addressMsg = /Check the address|Is this a Substack/.test(r.err);
  const outageMsg = /did not answer just now|taking too long|could not read that archive automatically/i.test(r.err);
  const emptyMsg = /looks empty|no public essays/i.test(r.err);
  if (truth.kind === "book") {
    if (r.personalized) {
      const posts = Number((/^(\d+)\+? public/.exec(r.sub) || [])[1]);
      const words = Number(((/([\d,]+) words/.exec(r.sub) || [])[1] || "").replace(/,/g, ""));
      const pagesOnPage = Number(((/([\d,]+)-page/.exec(r.big) || [])[1] || "").replace(/,/g, ""));
      if (!truth.capped && Math.abs(posts - truth.posts) > 1)
        return { verdict: "FAIL", note: `posts ${posts} on page, ${truth.posts} in the independent read` };
      if (truth.capped && posts < truth.posts - 1)
        return { verdict: "FAIL", note: `posts ${posts} on page, at least ${truth.posts} in the independent read` };
      if (!truth.capped && Math.abs(words - truth.words) > Math.max(200, truth.words * 0.02))
        return { verdict: "FAIL", note: `words ${words} on page, ${truth.words} in the independent read` };
      if (!r.verdict) notes.push("desk verdict empty");
      if (pagesOnPage && !truth.capped && Math.abs(pagesOnPage - truth.est_pages) > 2 && !/shelf|volumes/.test(r.big))
        return { verdict: "FAIL", note: `${pagesOnPage} pages on page, ${truth.est_pages} in the independent read` };
      return { verdict: notes.length ? "FAIL" : "PASS", note: notes.join("; ") || `${posts} posts, ${words} words` };
    }
    if (addressMsg) return { verdict: "FAIL", note: `live archive called not-Substack: "${r.err.slice(0, 80)}"` };
    if (outageMsg) return { verdict: "DEGRADED", note: r.handoff ? "outage message with hand-built route" : "outage message, hand-built route missing" };
    if (emptyMsg) return { verdict: "FAIL", note: `live archive with ${truth.posts} public posts called empty` };
    return { verdict: "FAIL", note: `unexpected: "${r.err.slice(0, 80)}"` };
  }
  if (truth.kind === "empty") {
    if (emptyMsg) return { verdict: "PASS", note: "empty, said so" };
    if (r.personalized) return { verdict: "FAIL", note: "independent read found no public posts in window but the page built a book" };
    if (outageMsg) return { verdict: "DEGRADED", note: "outage message on an empty archive" };
    return { verdict: "FAIL", note: `expected the empty message, got "${r.err.slice(0, 80)}"` };
  }
  if (truth.kind === "not_substack") {
    if (addressMsg) return { verdict: "PASS", note: `not Substack (${truth.detail}), said so` };
    if (r.personalized) return { verdict: "FAIL", note: `independent read says not Substack (${truth.detail}) but the page built a book` };
    return { verdict: "DEGRADED", note: `not Substack (${truth.detail}), page said "${r.err.slice(0, 60)}"` };
  }
  /* unknown truth: record what the page did */
  if (r.personalized) return { verdict: "UNKNOWN", note: `page built a book; independent read ${truth.detail}` };
  return { verdict: "UNKNOWN", note: `page: "${r.err.slice(0, 60)}"; independent read ${truth.detail}` };
}

const engine = { chromium, webkit, firefox }[engineName];
if (!engine) { console.error(`unknown engine ${engineName}`); process.exit(2); }

console.log(`RANDOM BATTERY seed=${SEED} n=${N} engine=${engineName} base=${base}`);
const sample = await drawSample(N);
console.log(`drew ${sample.length} publications (${sample.filter(s => s.custom).length} on custom domains)\n`);

const browser = await engine.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const rows = [];
try {
  for (const [i, s] of sample.entries()) {
    const page = await ctx.newPage();
    const [truth, r] = await Promise.all([truthFor(s.host), drive(page, s.pasted).catch(e => ({ err: "", errs: ["harness: " + String(e).slice(0, 120)], ms: PER_PUB_MS, personalized: false }))]);
    await page.close();
    const j = judge(truth, r);
    const outcome = r.personalized ? `book: ${r.big.slice(0, 50)}` : r.err ? `"${r.err.slice(0, 60)}"` : "silent";
    rows.push({ i: i + 1, ...s, truth: truth.kind + (truth.kind === "book" ? ` ${truth.posts}p${truth.capped ? "+" : ""}` : ""), outcome, s: (r.ms / 1000).toFixed(1), ...j });
    console.log(`${j.verdict.padEnd(8)} ${String(i + 1).padStart(2)} ${s.host.padEnd(40)} ${(r.ms / 1000).toFixed(1).padStart(5)}s  ${outcome}  ${j.note ? "· " + j.note : ""}`);
  }
} finally { await browser.close(); }

const count = v => rows.filter(r => r.verdict === v).length;
const times = rows.map(r => Number(r.s)).sort((a, b) => a - b);
const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
const fails = count("FAIL"), degraded = count("DEGRADED"), unknown = count("UNKNOWN"), pass = count("PASS");
const okRun = fails === 0 && degraded <= Math.ceil(rows.length * 0.1) && p95 <= 45;

const notCovered = [
  "Publications not in Substack's category listings (unlisted, private, or brand new)",
  "Paid-only archives with an export (the page cannot see them; truth here is the public list only)",
  "Touch hardware, screen readers, and the signup after the book (journeys A2, A4, A12 cover those on fixed hosts)",
  "An outage that starts mid-read: each publication is read once, at the moment it was drawn",
  "Non-Latin publication names in the masthead and cover (recorded, not judged)",
  "The stale-cache path when the base has no D1 (local runs read cold every time)",
];

const d0 = new Date();
const date = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-${String(d0.getDate()).padStart(2, "0")}`;
const md = [
  `# Random-publication battery, ${date}, seed ${SEED}`,
  ``,
  `Engine ${engineName}, base ${base}, ${rows.length} publications drawn from Substack's public category listings (${sample.filter(s => s.custom).length} on custom domains).`,
  `Result: ${okRun ? "PASS" : "FAIL"}: ${pass} pass, ${degraded} degraded, ${fails} fail, ${unknown} unknown; p95 ${p95}s, slowest ${times[times.length - 1]}s.`,
  `Repeat with \`node scripts/test-random-substacks.mjs ${engineName} ${base} --n=${N} --seed=${SEED}\`.`,
  ``,
  `| # | host | pasted as | independent read | page outcome | s | verdict | note |`,
  `|---|---|---|---|---|---|---|---|`,
  ...rows.map(r => `| ${r.i} | ${r.host} | \`${r.pasted}\` | ${r.truth} | ${r.outcome.replace(/\|/g, "/")} | ${r.s} | ${r.verdict} | ${(r.note || "").replace(/\|/g, "/")} |`),
  ``,
  `## Not covered`,
  ``,
  ...notCovered.map(n => `- ${n}`),
  ``,
].join("\n");
mkdirSync("evidence/random", { recursive: true });
const out = `evidence/random/${date}-seed${SEED}-${engineName}-${base.replace(/^https?:\/\//, "").replace(/[^a-z0-9.]+/gi, "_")}.md`;
writeFileSync(out, md);

console.log(`\n${okRun ? "RANDOM BATTERY PASS" : "RANDOM BATTERY FAIL"}: ${pass} pass, ${degraded} degraded, ${fails} fail, ${unknown} unknown; p95 ${p95}s`);
console.log(`evidence: ${out}`);
console.log(`not covered:\n${notCovered.map(n => "  - " + n).join("\n")}`);
process.exit(okRun ? 0 : 1);
