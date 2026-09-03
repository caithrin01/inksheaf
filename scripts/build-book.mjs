#!/usr/bin/env node
// Build a proof PDF book (HTML for Paged.js) from a Substack publication's public archive.
// v0 of the plan's Phase-2 renderer. Usage:
//   node scripts/build-book.mjs <publication-url> [--out proofs/name.html]
// Honest limits (recorded in evidence): footnotes render as per-article endnotes;
// images stay RGB; embeds become source cards. Proofs are watermarked.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import QRCode from "qrcode";
import { normalizeUrl, linkCode, SHORT_HOST } from "../functions/lib/links.js";
import { transformComponents } from "./lib/components.mjs";
import { ruleCut } from "../functions/lib/cuts.js";
import { extractBrand, contrastHex } from "./brand-lift.mjs";

const RAW = process.argv[2] || "https://www.caithrin.com";
const OUT = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : "proofs/book.html";

const UA = { "user-agent": "Mozilla/5.0 inksheaf-proof/0.1", accept: "application/json" };
const PRINT_INTERIOR = process.argv.includes("--print-interior");
// A production interior must never silently use the smaller proof-image path.
const MODE = (process.argv.includes("--images-print") || PRINT_INTERIOR) ? "print" : "proof";
const NO_BRAND = process.argv.includes("--no-brand");
const argOf = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const IMG_MAX = Math.max(1.5, Math.min(5.5, Number(argOf("--img-max")) || 4.2)); /* inches; the fit loop (--defer) handles placement */
const DEFER = String(argOf("--defer") || "").split(",").map(x => x.trim()).filter(Boolean);
/* --include slug,slug: the writer's reversals of rule cuts and guest cuts, from the change page */
const INCLUDE = new Set(String(argOf("--include") || "").split(",").map(x => x.trim()).filter(Boolean));
/* --isbn 978…: printed on the copyright page; the cover wrap draws its barcode (a free Lulu ISBN needs both) */
const ISBN = (() => { const raw = String(argOf("--isbn") || "").replace(/[^0-9Xx]/g, ""); return /^(97[89]\d{10}|\d{9}[0-9Xx])$/.test(raw) ? raw.replace(/^(\d{3})(\d)(\d{2,5})(\d{2,7})(\d)$/, (m, a, b, c, d, e) => `${a}-${b}-${c}-${d}-${e}`) : ""; })();
if (argOf("--isbn") && !ISBN) console.error("--isbn ignored: not a 10- or 13-digit ISBN:", argOf("--isbn"));
const AFTER = argOf("--after"), BEFORE = argOf("--before");
const BW = process.argv.includes("--interior-bw");
const COVER_PHOTO = process.argv.includes("--cover-photo");
const TOP = argOf("--top") ? +argOf("--top") : null;
// --posts <file.json>: an exact post list (ids or slugs, in reading order) from an editorial
// plan (plan-end-to-end-v1). The listing is filtered to it and ordered by it.
const POSTS_FILE = argOf("--posts");
// --dedication "text": one line on its own page before the contents (the change page)
const DEDICATION = (argOf("--dedication") || "").trim().slice(0, 300);
const ONLY = POSTS_FILE ? JSON.parse(readFileSync(POSTS_FILE, "utf-8")).map(String) : null;
const COMMENTS_N = argOf("--comments-appendix") ? +argOf("--comments-appendix") : 0;
const BRAND_FILE = process.argv.includes("--brand-file")
  ? process.argv[process.argv.indexOf("--brand-file") + 1] : null;
let host = new URL(RAW.includes("://") ? RAW : "https://" + RAW).hostname;

/* ---------------- fetch ---------------- */
async function j(url) {
  for (let a = 0; a < 5; a++) {
    const r = await fetch(url, { headers: UA, redirect: "follow" });
    if (r.status === 429 || r.status >= 500) { await new Promise(z => setTimeout(z, 1500 * (a + 1))); continue; }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  }
  throw new Error(`429/5xx after retries ${url}`);
}
async function text(url) {
  const r = await fetch(url, { headers: { ...UA, accept: "text/html" }, redirect: "follow" });
  return r.ok ? r.text() : "";
}

const FIXTURE = process.argv.includes("--fixture")
  ? process.argv[process.argv.indexOf("--fixture") + 1] : null;
console.error(FIXTURE ? "using fixture " + FIXTURE : "fetching archive for " + host);
const listing = [];
if (FIXTURE) {
  const fx = JSON.parse((await import("node:fs")).readFileSync(FIXTURE, "utf-8"));
  listing.push(...fx.map(p => ({ audience: "everyone", type: "newsletter", ...p })));
}
if (!FIXTURE)
// Page by the count received: Substack's first page answers 23 for limit=25 and offset counts
// posts, so a fixed stride of 25 skipped posts 23 and 24 of every archive (found 2026-09-01
// on the caithrin edition: the plan named 23 posts, the build found 21).
for (let offset = 0; ; ) {
  const page = await j(`https://${host}/api/v1/archive?sort=new&offset=${offset}&limit=25`);
  offset += Array.isArray(page) ? page.length : 25;
  if (!Array.isArray(page) || !page.length) break;
  listing.push(...page);
  /* stop when the read has what it needs: every planned post, or the window's start, or a
     daily letter's fifteen months (about 1,500 rows); never at an arbitrary 400 */
  if (ONLY && ONLY.every(k => listing.some(p => String(p.id) === k || String(p.slug) === k))) break;
  const oldest = page[page.length - 1]?.post_date || "";
  if (AFTER && oldest && Date.parse(oldest) < Date.parse(AFTER)) break;
  if (listing.length > 1800) break;
  await new Promise(r => setTimeout(r, 400));
}
const report = { host, listed: listing.length, skips: [], deadImages: [],
  omittedPaid: 0, podcastPosts: 0, declineSignals: [] };
report.omittedPaid = listing.filter(p => p.audience && p.audience !== "everyone").length;
report.podcastPosts = listing.filter(p => p.type === "podcast").length;
if (report.podcastPosts > listing.length / 2) report.declineSignals.push("podcast-first publication");
const shortPosts = listing.filter(p => (p.wordcount || 0) < 150).length;
if (shortPosts > listing.length * 0.6) report.declineSignals.push("thread/notes-style publication");
/* cuts by rule, each with its reason, named in the edition note (functions/lib/cuts.js) */
report.ruleCuts = [];
// A writer who canonicalizes every post to their own site (they own both the Substack and the
// domain, a common SEO setup) would otherwise have every post cut as "first published elsewhere"
// and get an empty book. If one non-substack canonical host covers half or more of the public
// posts, it is the writer's own domain; keep those. Foreign Substacks and one-offs still cut.
const hbare = host.replace(/^www\./, "").toLowerCase();
const canonCount = {};
for (const p of listing) {
  if (p.audience !== "everyone" || !(p.type === "newsletter" || !p.type)) continue;
  const c = String(p.canonical_url || ""); if (!/^https?:\/\//.test(c)) continue;
  const ch = c.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "").toLowerCase();
  if (ch && ch !== hbare && !/\.substack\.com$/.test(ch)) canonCount[ch] = (canonCount[ch] || 0) + 1;
}
const pubPublic = listing.filter(p => p.audience === "everyone" && (p.type === "newsletter" || !p.type)).length || 1;
const ownDomains = Object.entries(canonCount).filter(([, n]) => n >= pubPublic * 0.5).map(([d]) => d);
if (ownDomains.length) report.ownDomains = ownDomains;
for (const p of listing) { const why = ruleCut(p, host, ownDomains); if (why && p.audience === "everyone" && !INCLUDE.has(p.slug)) report.ruleCuts.push({ slug: p.slug, title: p.title, reason: why }); }
const cutSlugs = new Set(report.ruleCuts.map(c => c.slug));
/* the accounting invariant's terms (Codex audit P1-4): public pieces in the window before any cut */
report.eligiblePublic = listing.filter(p => p.audience === "everyone" && (p.type === "newsletter" || !p.type) && p.is_published !== false
  && (!AFTER || Date.parse(p.post_date) >= Date.parse(AFTER)) && (!BEFORE || Date.parse(p.post_date) < Date.parse(BEFORE))).length;
const posts = listing
  .filter(p => p.audience === "everyone" && !cutSlugs.has(p.slug))
  .filter(p => (!AFTER || Date.parse(p.post_date) >= Date.parse(AFTER))
            && (!BEFORE || Date.parse(p.post_date) <= Date.parse(BEFORE) + 86399000))
  .sort((a, b) => Date.parse(a.post_date) - Date.parse(b.post_date));
if (AFTER || BEFORE) report.window = { after: AFTER, before: BEFORE };
if (ONLY) {
  const rank = new Map(ONLY.map((k, i) => [k, i]));
  const keyOf = p => rank.has(String(p.id)) ? String(p.id) : rank.has(String(p.slug)) ? String(p.slug) : null;
  const missing = ONLY.filter(k => !posts.some(p => String(p.id) === k || String(p.slug) === k));
  posts.splice(0, posts.length, ...posts.filter(p => keyOf(p) !== null).sort((a, b) => rank.get(keyOf(a)) - rank.get(keyOf(b))));
  report.planSelection = { posts: ONLY.length, found: posts.length, missing };
}
const seenSlugs = new Set();
for (let i = 0; i < posts.length; ) {
  if (seenSlugs.has(posts[i].slug)) { report.skips.push({ slug: posts[i].slug, reason: "duplicate slug" }); posts.splice(i, 1); }
  else { seenSlugs.add(posts[i].slug); i++; }
}
let selectedFrom = null;
if (TOP && posts.length > TOP) {
  selectedFrom = posts.length;
  const d0 = new Date(Math.min(...posts.map(p2 => Date.parse(p2.post_date))));
  const d1 = new Date(Math.max(...posts.map(p2 => Date.parse(p2.post_date))));
  const fmtM = d => d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  var archiveRange = `${fmtM(d0)} – ${fmtM(d1)}`;
  const key = p2 => p2.id ?? p2.slug;
  const keep = new Set([...posts].sort((a, b) => (b.reaction_count || 0) - (a.reaction_count || 0))
    .slice(0, TOP).map(key));
  for (let i = posts.length - 1; i >= 0; i--) if (!keep.has(key(posts[i]))) posts.splice(i, 1);
  report.selection = { top: TOP, from: selectedFrom };
}
/* pre-flight page estimate: refuse a book the bindery cannot take BEFORE fetching
   hundreds of bodies and running a render that can hang or exhaust memory.
   Same formula as the site preview. Override deliberately with --force-pages. */
{
  const estWords = posts.reduce((a, p) => a + (Number(p.wordcount) || 0), 0);
  const estPages = Math.round(estWords / 270 + posts.length + 10);
  report.estPages = estPages;
  if (estPages > 800 && !process.argv.includes("--force-pages")) {
    console.error(`REFUSED before fetch: ~${estPages}pp estimated from ${posts.length} posts ` +
      `(bindery limit 800pp; we recommend volumes under 300pp). Build volumes with --after/--before ` +
      `date windows per the preview's division plan, or pass --force-pages to override.`);
    process.exit(2);
  }
  if (estPages > 300) {
    report.pageWarning = estPages > 800
      ? `~${estPages}pp is past the bindery limit of 800; built only because --force-pages was passed`
      : `~${estPages}pp is over the recommended 300pp per volume (bindery limit 800); consider date windows`;
    console.error("WARNING: " + report.pageWarning);
  }
}

console.error(listing.length, "listed;", posts.length, "printable;", report.omittedPaid, "paid omitted");

const deduped = posts;
const { mkdirSync: mkd, readFileSync: rdf, writeFileSync: wrf, existsSync: exf } = await import("node:fs");
const CACHE = `proofs/.cache/${host}`;
if (!FIXTURE) mkd(CACHE, { recursive: true });
// `post_date` does not change when an author corrects a published post. Cache against
// `updated_at` when Substack provides it so a correction cannot remain stale forever.
const cachePath = p2 => `${CACHE}/${p2.slug}--${Date.parse(p2.updated_at || p2.post_date)}.json`;
const full = [];
if (FIXTURE) full.push(...deduped.filter(p => p.body_html && p.body_html.length <= 2_000_000 ||
  (report.skips.push({ slug: p.slug, reason: p.body_html ? "body over 2MB" : "empty body" }), false)));
else for (const p of deduped) {
  const cp = cachePath(p);
  if (exf(cp)) { full.push(JSON.parse(rdf(cp, "utf-8"))); continue; }
  try {
    const d = await j(`https://${host}/api/v1/posts/${encodeURIComponent(p.slug)}`);
    if (d.body_html && d.body_html.length <= 2_000_000) { full.push(d); wrf(cp, JSON.stringify(d)); }
    else report.skips.push({ slug: p.slug, reason: d.body_html ? "body over 2MB" : "empty body" });
  } catch (e) { report.skips.push({ slug: p.slug, reason: String(e.message) }); }
  await new Promise(r => setTimeout(r, 350));
}
console.error(full.length, "bodies fetched");

// publication meta from homepage
const home = FIXTURE ? "" : await text(`https://${host}`);
let pubName = (home.match(/property="og:site_name" content="([^"]+)"/) || [])[1]
  || full[0]?.publishedBylines?.[0]?.name || host.split(".")[0];
let pubDesc = (home.match(/property="og:description" content="([^"]+)"/) || [])[1] || "";
pubDesc = decodeEntities(pubDesc.replace(/\s*Click to read.*$/i, "").trim());

/* ---------- brand lift: the publication's own theme drives the book ---------- */
let brand = null;
if (BRAND_FILE) brand = JSON.parse((await import("node:fs")).readFileSync(BRAND_FILE, "utf-8"));
else if (!NO_BRAND && !FIXTURE) {
  try { brand = await extractBrand(host); }
  catch (e) { console.error("brand lift failed, neutral design used:", String(e.message)); }
}
const B = {
  accent: brand?.accent || "#a63a2b",
  headingFont: brand?.heading_font || "Source Serif 4",
  headingWeight: brand?.heading_weight || 560,
  bodyFont: brand?.body_font || "Source Serif 4",
  coverBg: (brand?.cover_usable && brand.cover_bg) || null,
  coverInk: (brand?.cover_usable && brand.cover_print) || null,
  coverInk2: (brand?.cover_usable && (brand.cover_print_secondary || brand.cover_print)) || null,
  fontsUrl: brand?.fonts_css_url || null,
};
B.coverRule = B.coverBg && contrastHex(B.accent, B.coverBg) >= 3 ? B.accent : (B.coverInk || "#a63a2b");
if (brand?.publication_name && brand.publication_name.trim()) pubName = brand.publication_name.trim();
let coverPlate = null;
if (COVER_PHOTO && brand?.cover_photo_url) {
  try {
    const cfs = await import("node:fs"); const ccr = await import("node:crypto");
    cfs.mkdirSync("proofs/.cache/img", { recursive: true });
    const cu = brand.cover_photo_url;
    const ch = ccr.createHash("sha1").update(cu).digest("hex").slice(0, 16);
    const cpath = `proofs/.cache/img/${ch}-cover.png`;
    if (!cfs.existsSync(cpath)) {
      const cr = await fetch(cu, { headers: { "user-agent": UA["user-agent"] } });
      if (!cr.ok) throw new Error(cr.status);
      cfs.writeFileSync(cpath, Buffer.from(await cr.arrayBuffer()));
    }
    const dim = (cu.match(/_(\d+)x(\d+)\./) || []).slice(1).map(Number);
    coverPlate = { path: cpath.replace("proofs/", ""), w: dim[0] || null, h: dim[1] || null };
    if (dim[0] && dim[0] < 900) report.brand && (report.brand.warnings = [...(report.brand.warnings||[]), "cover photo under 900px; plate prints soft"]);
  } catch (e) { console.error("cover photo unavailable:", String(e.message)); }
}
if (brand) report.brand = { accent: B.accent, headingFont: B.headingFont, bodyFont: B.bodyFont,
  coverBg: B.coverBg, coverPlate: !!coverPlate, mappedFrom: brand.heading_font_mapped_from, warnings: brand.warnings };
const byCount = {};
/* every byline counts, not only the first (co-authored posts kept losing a name); a guest is
   is_guest on the byline. Guest posts leave the book by default (Caithrin, 2026-09-02: a guest
   owns the piece), named in the edition note; --include-guests keeps them with a label. */
const bylinesOf = p2 => (Array.isArray(p2.publishedBylines) ? p2.publishedBylines : []).filter(b => b && b.name);
const isGuestPost = p2 => { const bs = bylinesOf(p2); return bs.length > 0 && bs.every(b => b.is_guest); };
report.guestCuts = [];
if (!process.argv.includes("--include-guests")) {
  for (let i = full.length - 1; i >= 0; i--) if (isGuestPost(full[i]) && !INCLUDE.has(full[i].slug)) { report.guestCuts.push({ slug: full[i].slug, title: full[i].title, by: bylinesOf(full[i]).map(b => b.name).join(", ") }); full.splice(i, 1); }
}
for (const p2 of full) for (const b of bylinesOf(p2)) byCount[b.name] = (byCount[b.name] || 0) + 1;
const authors = Object.entries(byCount).sort((a, b) => b[1] - a[1]).map(([n]) => n);
const multi = authors.length > 1;
const author = authors[0] || pubName;
report.editorExcluded = report.planSelection ? Math.max(0, report.eligiblePublic - report.ruleCuts.length - (report.planSelection.requested || full.length)) : 0;
report.pubName = pubName; report.author = author; report.authors = authors.slice(0, 6); report.isbn = ISBN || null;
/* the edition version's inputs (Codex audit P0-1): the posts in book order and a hash of each
   body as fetched, so a later run can tell whether what it would print is what was approved */
{ const { createHash: ch } = await import("node:crypto");
  report.postOrder = full.map(p => ({ id: p.id ?? p.slug, slug: p.slug }));
  report.bodyHashes = Object.fromEntries(full.map(p => [String(p.id ?? p.slug), ch("sha256").update(String(p.body_html || "")).digest("hex")])); }
const dominantShare = full.length ? (byCount[author] || 0) / full.length : 1;

/* ---------- content kind: what the pieces ARE drives every label ---------- */
const DATE_TITLE = /^[A-Z][a-z]+ \d{1,2},? \d{4}[.\s]*$/;
const NOUNS = { essays: "essay", letters: "letter", recipes: "recipe", poems: "poem",
  stories: "story", reviews: "review", dispatches: "dispatch", pieces: "piece" };
const KIND_KEYWORDS = { recipe: "recipes", poem: "poems", poetry: "poems", letter: "letters",
  fiction: "stories", story: "stories", review: "reviews", dispatch: "dispatches" };
function detectKind() {
  const flagIdx = process.argv.indexOf("--noun");
  if (flagIdx > -1) { const n = process.argv[flagIdx + 1]; return NOUNS[n] ? n : "pieces"; }
  const dateFrac = full.filter(p2 => DATE_TITLE.test((p2.title || "").trim())).length / Math.max(1, full.length);
  if (dateFrac > 0.5) return "letters";
  const votes = {};
  for (const p2 of full)
    for (const t of [...(p2.postTags || []).map(t2 => t2?.name || t2), p2.section_name])
      for (const [kw, kind] of Object.entries(KIND_KEYWORDS))
        if (String(t || "").toLowerCase().includes(kw)) votes[kind] = (votes[kind] || 0) + 1;
  const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= full.length * 0.3 ? top[0] : "essays";
}
const kind = detectKind();
const noun = kind, nounOne = NOUNS[kind] || "piece";
const capNoun = noun.charAt(0).toUpperCase() + noun.slice(1);
report.kind = kind;

/* media-only pieces (video/audio interviews with no prose) never print as empty chapters */
report.mediaOnly = 0;
for (let i = full.length - 1; i >= 0; i--) {
  const words = String(full[i].body_html || "").replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
  const hasEmbed = /<iframe|youtube|youtu\.be|\bvimeo\b|podcast_url/i.test(full[i].body_html || "") || full[i].podcast_url;
  if (words < 50 && hasEmbed) { report.mediaOnly++; full.splice(i, 1); }
}
report.included = full.length;
if (!report.included) {
  mkdirSync(OUT.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  writeFileSync(OUT.replace(/\.html$/, ".report.json"), JSON.stringify(report, null, 2));
  // graceful decline (not a crash): every post was filtered out (cross-posts, guests, housekeeping,
  // paid, or too short), so there is nothing to bind. Exit 3 so a caller can tell this apart.
  console.error("No printable public posts remained after filtering; nothing to bind. This publication cannot make a book from its public archive.");
  process.exit(3);
}

/* excerpts + date-titled flags for navigable letters TOCs */
for (const p2 of full) {
  p2.title = String(p2.title || "").trim();
  p2._dateTitled = DATE_TITLE.test((p2.title || "").trim());
  const txt = String(p2.body_html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  p2._excerpt = txt.split(" ").slice(0, 9).join(" ").replace(/[.,;:!?]+$/, "");
}

/* parts: month sections for letters; named sections when a publication truly uses them */
const distinctSections = [...new Set(full.map(p2 => p2.section_name).filter(Boolean))];
const sectionCoverage = full.filter(p2 => p2.section_name).length / Math.max(1, full.length);
let partOf = null, partTitles = [];
if (kind === "letters") {
  partOf = p2 => new Date(Date.parse(p2.post_date)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
} else if (distinctSections.length >= 2 && sectionCoverage >= 0.6) {
  partOf = p2 => p2.section_name || "General";
}
if (partOf) for (const p2 of full) { const t = partOf(p2); if (!partTitles.includes(t)) partTitles.push(t); }
report.parts = partTitles;
let authorLine = author;
if (multi) {
  const cut = Math.max(2, Math.ceil(full.length * 0.1));
  const principals = authors.filter(a => byCount[a] >= cut);
  const rest = authors.length - principals.length;
  const label = { essays: "Essays", letters: "Letters", recipes: "Recipes", poems: "Poems",
    stories: "Stories", reviews: "Reviews", dispatches: "Dispatches", pieces: "Writing" }[kind] || "Writing";
  authorLine = label + " by " + (principals.length ? principals.join(", ") : authors.slice(0, 3).join(", "))
    + (rest > 0 ? `, with contributions from ${rest} other${rest === 1 ? "" : "s"}` : "");
}

/* ---------------- clean bodies ---------------- */
const KILL = [
  /<div[^>]*class="[^"]*(subscription-widget|button-wrapper|subscribe-widget|post-footer|share|community-module|poll-embed|digest-post-embed)[^"]*"[^>]*>[\s\S]*?<\/div>\s*(<\/div>)?/gi,
  /<p[^>]*class="[^"]*button-wrapper[^"]*"[^>]*>[\s\S]*?<\/p>/gi,
  /<audio[\s\S]*?<\/audio>/gi,
];
function decodeCdn(src) {
  const m = src.match(/substackcdn\.com\/image\/fetch\/[^/]*\/(https?%3A[^"'\s]+)/);
  if (m) { try { return decodeURIComponent(m[1]); } catch { return src; } }
  return src;
}
function stripBalancedDivs(html, classRe) {
  // remove each <div class~=classRe> ... matching </div>, counting nested divs
  let out = html;
  for (let guard = 0; guard < 200; guard++) {
    const m = out.match(new RegExp(`<div[^>]*class="[^"]*(?:${classRe})[^"]*"[^>]*>`, "i"));
    if (!m) break;
    const start = m.index;
    let depth = 1, i = start + m[0].length;
    const tokens = /<div\b|<\/div>/gi;
    tokens.lastIndex = i;
    let t;
    while (depth > 0 && (t = tokens.exec(out))) depth += t[0] === "</div>" ? -1 : 1;
    const end = t ? tokens.lastIndex : out.length;
    out = out.slice(0, start) + out.slice(end);
  }
  return out;
}
function clean(html, slug) {
  /* Substack blocks by their own data-component-name first (scripts/lib/components.mjs): removed,
     substituted, or left alone and counted; the regex cleaners below are the second line */
  let s = transformComponents(html, report);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
       .replace(/<form[\s\S]*?<\/form>/gi, "");
  s = stripBalancedDivs(s, "embedded-publication-wrap|embedded-post-wrap|\\bcomment\\b|digest-post-embed|subscription-widget|poll-embed|community-module|image-link-expand|install-substack-app");
  s = s.replace(/<button[\s\S]*?<\/button>/gi, "");
  s = s.replace(/<p[^>]*>\s*<a[^>]*>(Leave a comment|Share|Subscribe now|Refer a friend|Give a gift subscription)<\/a>\s*<\/p>/gi, "");
  s = s.replace(/<a[^>]*>(Leave a comment|Subscribe now|Share this post|Refer a friend)<\/a>/gi, "");
  s = s.replace(/<img[^>]*(width="1"|height="1")[^>]*>/gi, "");
  s = s.replace(/>\s*\[\{"type":[\s\S]*?\}\]\s*</g, "><");
  // orphan separators left where an embed card was removed between list items
  s = s.replace(/(<li><p>)\s*;\s*/gi, "");
  s = s.replace(/<source[^>]*>/gi, "");
  for (const re of KILL) s = s.replace(re, "");
  // iframes and embeds become source cards
  s = s.replace(/<iframe[^>]*src="([^"]+)"[\s\S]*?<\/iframe>/gi, (_, src) => {
    let u = src.split("?")[0].replace(/^https?:\/\//, "");
    const yt = u.match(/(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)([\w-]{6,})/);
    if (yt) u = "youtube.com/watch?v=" + yt[1];
    return `<div class="embedcard">Viewable online: <span>${u.slice(0, 90)}</span></div>`;
  });
  s = s.replace(/<div[^>]*class="[^"]*tweet[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi,
    `<div class="embedcard">A post from X, viewable in the online edition.</div>`);
  // images: proof mode keeps Substack CDN JPEGs (small); print mode uses decoded S3 originals
  let figN = 0;
  s = s.replace(/<img[^>]+>/gi, tag => {
    const src = (tag.match(/src="([^"]+)"/) || [])[1] || "";
    const alt = (tag.match(/alt="([^"]*)"/) || [])[1] || "";
    if (!src) return "";
    const out = MODE === "print" ? decodeCdn(src) : src.replace(/w_\d+/, "w_1100").replace("f_auto", "f_jpg").replace("q_auto:good", "q_80").replace(",fl_progressive:steep", "");
    return `<img src="${out}" alt="${alt}" data-fig="${slug}:${++figN}">`;
  });
  /* --defer a:3,b:1 : an image the renderer found pushed whole to the next page (leaving the
     page it left mostly white) moves past the next two paragraphs, so the text fills the page
     and the image opens the next one. The fit loop in scripts/lib/fit.mjs supplies the list. */
  for (const id of DEFER) {
    if (!id.startsWith(slug + ":")) continue;
    const fig = new RegExp(`(<figure\\b[^>]*>(?:(?!<\\/figure>)[\\s\\S])*?<img[^>]*data-fig="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>[\\s\\S]*?<\\/figure>|<img[^>]*data-fig="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>(?:\\s*<div class="gifnote">[^<]*<\\/div>)?)`);
    const m = s.match(fig); if (!m) continue;
    const block = m[0]; const start = m.index; let rest = s.slice(start + block.length);
    let cut = 0, seen = 0;
    const re = /<\/p>/g; let t; while (seen < 2 && (t = re.exec(rest))) { cut = re.lastIndex; seen++; }
    if (!seen) continue;
    s = s.slice(0, start) + rest.slice(0, cut) + block + rest.slice(cut);
  }
  // links (plan-formatting-v1 section 7, approved 2026-09-02): linked words stay plain with a
  // small superscript letter; the essay's "Links" note lists letter, text and a short URL
  // (inksheaf.com/l/<code>); one QR per essay to the essay online. Image links and footnote
  // anchors are not lettered. The letters and targets are collected here; the note is built by
  // the caller once the codes (async) exist.
  const found = []; let li = 0;
  const letter = i => { let n = i, out = ""; do { out = "abcdefghijklmnopqrstuvwxyz"[n % 26] + out; n = Math.floor(n / 26) - 1; } while (n >= 0); return out; };
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (m, attrs, inner) => {
    if (/class="[^"]*(footnote-anchor|fn)\b/.test(attrs) || /<img\b/i.test(inner)) return m;
    const href = (attrs.match(/href="([^"]+)"/) || [])[1] || ""; const target = normalizeUrl(href);
    if (!target) return inner; /* an anchor without a usable target keeps its words only */
    const text = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!text) return inner;
    let L = found.find(f => f.target === target)?.letter; if (!L) { L = letter(li++); found.push({ letter: L, target, text: text.slice(0, 120) }); }
    return `<a href="${href}" data-link="${L}">${inner}</a>`;
  });
  LINKS.set(slug, found);
  // anchors: keep text, drop link boxes styling issues; footnote anchors keep their number
  s = s.replace(/<a([^>]*class="footnote-anchor"[^>]*)>/gi, "<a$1 class=\"fn\">");
  // namespace footnote ids per article so links stay unique
  s = s.replaceAll('id="footnote-', `id="fn-${slug}-`)
       .replaceAll('href="#footnote-', `href="#fn-${slug}-`);
  // Source notes written into the body (Caithrin's "sources & notes (AI generated)" sections and
  // the like): scripts/lib/notes-detect.mjs finds the trailing block that reads as citations,
  // by structure first, heading words second, a model for the ambiguous band. The block becomes
  // <section class="srcnotes">; plain "- " paragraphs inside become a list. The renderers set it
  // small and unindented, and the notes policy can move it to the back of the book.
  const decided = NOTES.get(slug);
  /* the decision was made on the raw body; the offsets are found again on the cleaned string */
  const nd = decided ? (detectNotes(s) || null) : null;
  if (decided && !nd) report.notesLost = (report.notesLost || 0) + 1;
  if (nd) {
    const head = s.slice(nd.start).match(/^<(h[2-4])[^>]*>([\s\S]*?)<\/\1>/i);
    let rest = s.slice(nd.start + (head ? head[0].length : 0)).replace(/^<hr[^>]*>/i, "");
    rest = rest.replace(/<p>\s*[-–•]\s+([\s\S]*?)<\/p>/g, "<li><p>$1</p></li>");
    rest = rest.replace(/(?<!<[uo]l>\s*)((?:<li>[\s\S]*?<\/li>\s*)+)(?!\s*<\/[uo]l>)/g, "<ul>$1</ul>"); /* only runs of items outside a list */
    s = s.slice(0, nd.start) + `<section class="srcnotes"><h2 class="srcnotes-h">${esc(decided.heading || nd.heading || "Sources & notes")}</h2>${rest}</section>`;
    report.srcnotes = (report.srcnotes || 0) + 1;
  }
  // first real paragraph gets an explicit opener class; Paged.js drops :first-of-type::first-letter
  s = s.replace(/<p\b(?![^>]*class=)([^>]*)>/, '<p class="opener"$1>');
  // verse: paragraphs with manual line breaks set ragged, unindented, unhyphenated
  s = s.replace(/<p\b([^>]*)>((?:(?!<\/p>)[\s\S])*<br[\s\S]*?)<\/p>/gi,
    (m, attrs, inner) => `<p${attrs.includes('class="') ? attrs.replace('class="', 'class="verse ') : attrs + ' class="verse"'}>${inner}</p>`);
  // bare long URLs in prose get an explicit breakable, left-set span
  s = s.replace(/(?<=>|\s)(https?:\/\/[^\s<>"]{35,})/g, '<span class="longurl">$1</span>');
  // GIFs print one frame; say so
  s = s.replace(/<img src="([^"]+\.gif[^"]*)"([^>]*)>/gi,
    '<img src="$1"$2><div class="gifnote">Animation; one frame printed. The moving version is in the online edition.</div>');
  return s;
}

/* ---------------- back-matter data: curated links + optional comments appendix ---------------- */
let homeLinks = [];
if (!FIXTURE) {
  try {
    const hl = await j(`https://${host}/api/v1/homepage_links`);
    if (Array.isArray(hl)) homeLinks = hl.sort((a, b) => (a.rank || 0) - (b.rank || 0)).slice(0, 8);
  } catch {}
}
let commentPicks = [];
if (COMMENTS_N > 0 && !FIXTURE) {
  const ranked = [...full].sort((a, b) => (b.reaction_count || 0) - (a.reaction_count || 0)).slice(0, COMMENTS_N);
  for (const p2 of ranked) {
    try {
      const cd = await j(`https://${host}/api/v1/post/${p2.id}/comments?sort=best_first`);
      const c = (cd.comments || []).filter(c2 => !c2.deleted && c2.name && String(c2.body || "").trim().split(/\s+/).length >= 8)
        .sort((a, b) => (b.reaction_count || 0) - (a.reaction_count || 0))[0];
      if (c) commentPicks.push({ article: p2.title, name: c.name,
        body: String(c.body).split(/\s+/).slice(0, 80).join(" "),
        truncated: String(c.body).split(/\s+/).length > 80, likes: c.reaction_count || 0 });
    } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  report.commentsAppendix = commentPicks.length;
}

/* ---------------- QR codes ---------------- */
const qrPub = await QRCode.toDataURL(`https://${host}`, { margin: 0, width: 220, color: { dark: "#221d16", light: "#0000" } });
const qrInk = await QRCode.toDataURL("https://inksheaf.pages.dev", { margin: 0, width: 220, color: { dark: "#221d16", light: "#0000" } });

/* ---------------- assemble ---------------- */
const dates = full.map(p => Date.parse(p.post_date)).sort((a, b) => a - b);
const dfmt = t => new Date(t).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dayfmt = t => new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
// a volume inside one month reads "July 2025", not "July 2025 – July 2025"
const range = dfmt(dates[0]) === dfmt(dates[dates.length - 1]) ? dfmt(dates[0]) : `${dfmt(dates[0])} – ${dfmt(dates[dates.length - 1])}`;
const year = new Date(dates[dates.length - 1]).getUTCFullYear();
const y0 = new Date(dates[0]).getUTCFullYear();
const spanMonths = (dates[dates.length - 1] - dates[0]) / 2629800000;
const yspan = y0 === year ? String(year) : y0 + "–" + year;
let kindLabel = spanMonths <= 4 ? `Quarterly · ${year}`
  : (spanMonths >= 10 && spanMonths <= 14) ? `Annual · ${year}`
  : `Collected ${capNoun} · ${yspan}`;
let volLabel = spanMonths <= 4 ? `The ${year} Quarterly` : (spanMonths >= 10 && spanMonths <= 14) ? `The ${year} Annual` : `Collected ${capNoun}`;
if (report.selection) { kindLabel = `Selected ${capNoun} · ${yspan}`; volLabel = `Selected ${capNoun}`; }
// --vol-label "Q3 2025" [--vol-of "I of IV"]: the plan's own name for this volume (the press)
{ const VL = argOf("--vol-label"), VO = argOf("--vol-of");
  const escv = x => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (VL) { volLabel = escv(VL); kindLabel = `${escv(VL)}${VO ? ` · Vol. ${escv(VO)}` : ""}`; } }
const totalWords = full.reduce((s, p) => s + (p.wordcount || 0), 0);
for (const p2 of full) if ((p2.title || "").length > 120)
  report.skips.push({ slug: p2.slug, reason: "title over 120 chars kept, check running head", kept: true });

const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function decodeEntities(s) { return String(s || "")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&"); }

function tocRow(p, i) {
  const b = bylinesOf(p).map(x => x.name).join(", ");
  const showBy = multi && b && (dominantShare < 0.5 || b !== author);
  let label = esc(p.title);
  if (p._dateTitled) {
    const day = new Date(Date.parse(p.post_date)).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
    label = `${day} <span class="tocex">— ${esc(p._excerpt)}…</span>`;
  }
  return `<div class="tocrow"><span class="toct"><a href="#art-${i}">${label}</a>${showBy ? `<span class="tocby"> · ${esc(b)}</span>` : ""}</span><span class="tocdots"></span><span class="tocn"><a href="#art-${i}"></a></span></div>`;
}
let tocRows;
if (partOf) {
  let cur = null; const chunks = [];
  full.forEach((p, i) => {
    const t = partOf(p);
    if (t !== cur) { cur = t; chunks.push(`<div class="tocpart"><a href="#part-${partTitles.indexOf(t)}">${esc(t)}</a></div>`); }
    chunks.push(tocRow(p, i));
  });
  tocRows = chunks.join("\n");
} else {
  tocRows = full.map((p, i) => tocRow(p, i)).join("\n");
}

/* source-notes decisions, one per post, before cleaning (the model call is async) */
const { detectNotes, askModel } = await import("./lib/notes-detect.mjs");
const NOTES = new Map(); report.notesBlocks = [];
const LINKS = new Map(); report.links = []; report.essayLinks = [];
for (const p of full) {
  let d = detectNotes(p.body_html || ""); let how = d ? d.method : null;
  if (d && d.method === "ambiguous") { const m = await askModel(d.heading, (p.body_html || "").slice(d.start)); how = m == null ? "ambiguous-unresolved" : m ? "model" : "model-no"; if (m !== true) d = null; }
  if (d) { NOTES.set(p.slug, d); report.notesBlocks.push({ slug: p.slug, heading: d.heading, score: d.score, method: how }); }
}

/* the link note for each article, inserted after its body: lettered rows with short URLs, and
   one QR to the essay online through the same redirect. Codes come from the target, so the note
   is right before the press registers the rows. */
async function withLinkNotes(articlesHtml) {
  let out = articlesHtml;
  for (const p of full) {
    const found = LINKS.get(p.slug) || [];
    const canon = normalizeUrl(p.canonical_url || `https://${host}/p/${p.slug}`);
    const essayCode = canon ? await linkCode(canon) : null;
    if (essayCode) report.essayLinks.push({ slug: p.slug, code: essayCode, target: canon });
    if (!found.length) continue;
    const rows = [];
    for (const f of found) { const code = await linkCode(f.target); report.links.push({ slug: p.slug, letter: f.letter, code, target: f.target, text: f.text });
      rows.push(`<li><span class="lk">${f.letter}</span><span class="lk-text">${esc(f.text)}</span><span class="lk-url">${SHORT_HOST}${code}</span><span class="lk-target" data-target="${esc(f.target)}"></span></li>`); }
    const qr = essayCode ? await QRCode.toDataURL(`https://${SHORT_HOST}${essayCode}`, { margin: 0, width: 220, color: { dark: "#221d16", light: "#0000" } }) : null;
    const note = `<section class="linknote"><h2 class="linknote-h">Links</h2><ul>${rows.join("")}</ul>${qr ? `<div class="lk-qr"><img src="${qr}" alt="QR: this essay online"><span class="lk-essay">${SHORT_HOST}${essayCode}</span></div>` : ""}</section>`;
    const marker = `<section class="article" id="art-${full.indexOf(p)}">`;
    const i = out.indexOf(marker); if (i < 0) continue;
    const end = out.indexOf("</section>", out.indexOf('<div class="artbody">', i));
    const bodyEnd = out.indexOf("</div>\n</section>", i); /* the artbody closes right before the section */
    const at = bodyEnd > -1 ? bodyEnd + "</div>".length : end;
    out = out.slice(0, at) + "\n" + note + out.slice(at);
  }
  return out;
}
let lastPart = null;
const articles = full.map((p, i) => {
  let divider = "";
  if (partOf) {
    const t = partOf(p);
    if (t !== lastPart) { lastPart = t;
      divider = `<section class="part" id="part-${partTitles.indexOf(t)}"><div class="partkind">${esc(volLabel)}</div><h2 class="parttitle">${esc(t)}</h2></section>\n`; }
  }
  const b = bylinesOf(p).map(x => x.name).join(", ");
  const showBy = multi && b && (dominantShare < 0.5 || b !== author);
  const meta = [
    p._dateTitled ? null : dayfmt(Date.parse(p.post_date)),
    (p.wordcount || 0) >= 50 ? (p.wordcount || 0).toLocaleString("en-US") + " words" : null,
    showBy ? (isGuestPost(p) ? "guest post by " : "by ") + esc(b) : null,
  ].filter(Boolean).join(" · ");
  return divider + `
<section class="article" id="art-${i}">
  <header class="arthead">
    ${kind === "letters" ? "" : `<div class="artnum">${i + 1}</div>`}
    <h2 class="arttitle" data-title="${esc(p.title)}">${esc(p.title)}</h2>
    ${p.subtitle ? `<p class="artsub">${esc(p.subtitle)}</p>` : ""}
    <div class="artmeta">${meta}</div>
  </header>
  <div class="artbody">${clean(p.body_html, p.slug)}</div>
</section>`;
}).join("\n");

// script coverage: counts always reported; decline only when dominant
const allBody = full.map(p2 => p2.body_html).join("");
report.rtlChars = (allBody.match(/[\u0590-\u08FF]/g) || []).length;
report.cjkChars = (allBody.match(/[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/g) || []).length;
const totalChars = Math.max(1, allBody.length);
if (report.rtlChars / totalChars > 0.3) report.declineSignals.push("rtl-dominant content");
if (report.cjkChars / totalChars > 0.3) report.declineSignals.push("cjk-dominant content");
const langs = {};
for (const p2 of full) if (p2.language) langs[p2.language] = (langs[p2.language] || 0) + 1;
const lang = Object.entries(langs).sort((a, b) => b[1] - a[1])[0]?.[0] || "en";
const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${esc(pubName)} — ${esc(volLabel)} (Inksheaf ${PRINT_INTERIOR ? "interior" : "proof"})</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,300..700;1,8..60,300..700&display=swap" rel="stylesheet">
${B.fontsUrl ? `<link href="${B.fontsUrl}" rel="stylesheet">` : ""}
<style>
:root{ --ink:#221d16; --rubric:${B.accent}; --faint:#6d675c; --rule:#d8d2c2;
  --headfont:"${B.headingFont}"; --headweight:${B.headingWeight}; }
@page{ size: 6in 9in; margin: 0.72in 0.62in 0.78in 0.62in; }
@page chapter{
  margin: 0.72in 0.62in 0.78in 0.62in;
  @bottom-center{ content: counter(page); font-family: "Source Serif 4", serif; font-size: 8.5pt; color: #6d675c; }
  @top-left{ content: string(pubname); font-family: "Source Serif 4", serif; font-size: 7.5pt; letter-spacing: 0.14em; text-transform: uppercase; color: #6d675c; }
  @top-right{ content: string(arttitle); font-family: "Source Serif 4", serif; font-size: 7.5pt; font-style: italic; color: #6d675c; }
}
@page cover{ margin: 0; }
@page frontmatter{ margin: 0.72in 0.62in 0.78in 0.62in; }
html{ font-size: 10.5pt }
body{ font-family:"${B.bodyFont}", "Source Serif 4", Georgia, serif; color:var(--ink); line-height:1.5;
  font-optical-sizing:auto; margin:0 }
.pubsrc{ string-set: pubname content(text); height:0; overflow:hidden; visibility:hidden }
p{ margin:0 0 0 0; text-indent:1.35em; text-align:justify; hyphens:none; orphans:2; widows:2 }
.artbody > p:first-of-type{ text-indent:0 }

.about p, .getmore p{ text-indent:0 }
a{ color:inherit; text-decoration:none }
/* an image must always fit under an opener head, or Paged.js pushes it whole to the next page
   and leaves the page it left mostly white (blank-page detector, 2026-09-02); --img-max caps it */
img{ max-width:100%; max-height:${IMG_MAX}in; width:auto; height:auto; display:block; margin:.9em auto }
figure{ margin:1em 0; break-inside:avoid }
h2, h3, h4{ break-after:avoid; page-break-after:avoid } figcaption{ font-size:8.5pt; color:var(--faint); text-align:center; margin-top:.35em }
blockquote{ margin:.9em 1.4em; font-size:9.8pt; color:#3a352c }
h1,h2,h3,h4{ line-height:1.15; font-weight:var(--headweight); font-family:var(--headfont), "Source Serif 4", serif }
hr{ border:0; text-align:center; margin:1.2em 0 }
hr::after{ content:"❦"; color:var(--rubric); font-size:10pt }
ul,ol{ margin:.7em 0 .7em 1.5em; padding:0 }
li{ margin:.2em 0; text-align:justify; hyphens:none }
pre{ font-size:8pt; background:#f4efe4; padding:.6em; overflow:hidden; white-space:pre-wrap; word-break:break-word }
code{ font-size:8.5pt }
p.verse{ text-align:left; text-indent:0; hyphens:none }
.longurl{ word-break:break-all; hyphens:none; font-size:9pt }
.gifnote{ font-size:7.5pt; color:var(--faint); text-align:center; margin:-.5em 0 .9em }
table{ width:100%; border-collapse:collapse; font-size:8pt; margin:.9em 0 }
td, th{ border:1px solid var(--rule); padding:.25em .4em; word-break:break-word; text-align:left }
.imgmissing{ border:1px dashed var(--rubric); color:var(--faint); font-size:8.5pt; padding:1em; text-align:center; margin:.9em 0 }
.tweet-print{ margin:.9em 1.2em; font-size:9.8pt } .tweet-print .tweet-by{ text-indent:0; font-size:8.5pt; color:var(--faint); margin-top:.2em }
.latex-print{ text-align:center; text-indent:0; font-size:9.5pt }
.embedcard{ border:1px solid var(--rule); border-left:3px solid var(--rubric); padding:.6em .8em;
  font-size:8.5pt; color:var(--faint); margin:.9em 0; word-break:break-all }

/* ---------- front matter ---------- */
.cover{ page: cover; height:100%; position:relative;
  background:${B.coverBg || "#f6f1e6"}; color:${B.coverInk || "var(--ink)"};
  padding:1.1in .85in; box-sizing:border-box; break-after:page }
.cover .kind{ font-size:9pt; letter-spacing:.3em; text-transform:uppercase; color:${B.coverRule}; font-weight:600 }
.cover h1{ font-size:34pt; margin:.35in 0 0; letter-spacing:-.01em; color:${B.coverInk || "inherit"} }
.cover .rule{ width:.55in; border-bottom:3px solid ${B.coverRule}; margin:.28in 0 }
.cover .coverplate{ margin-top:.55in }
.cover .coverplate img{ width:2.9in; height:2.9in; object-fit:cover; display:block;
  border:1px solid ${B.coverInk2 || "var(--rule)"}; padding:.08in; background:transparent }
.cover .dates{ font-size:11pt; color:${B.coverInk2 || "var(--faint)"} }
.cover .foot{ position:absolute; bottom:.9in; left:.85in; right:.85in; border-top:1px solid ${B.coverInk2 || "var(--rule)"};
  padding-top:.16in; display:flex; justify-content:space-between; font-size:8.5pt; color:${B.coverInk2 || "var(--faint)"} }
.fm{ page: frontmatter; break-after:page }
.halftitle{ text-align:center; padding-top:2.6in; font-size:15pt; letter-spacing:.04em }
.dedication{ text-align:center; padding-top:2.9in; font-style:italic; font-size:13pt; max-width:3.6in; margin:0 auto }
.titlepage{ text-align:center; padding-top:1.9in }
.titlepage .t{ font-size:24pt; font-weight:560 }
.titlepage .s{ font-size:10.5pt; color:var(--faint); margin-top:.22in }
.titlepage .a{ margin-top:.75in; font-size:11pt }
.titlepage .imprint{ margin-top:1.55in; font-size:8.5pt; letter-spacing:.18em; text-transform:uppercase; color:var(--faint) }
.about h3, .toc h3, .getmore h3{ font-size:9pt; letter-spacing:.26em; text-transform:uppercase;
  color:var(--rubric); font-weight:600; margin:0 0 .3in }
.about p{ text-indent:0; margin-bottom:.6em }
.about .epigraph{ color:var(--faint); font-size:12.5pt; font-style:italic; text-align:center; margin:.2em 0 1.4em; padding:0 }
.about .colophon{ margin-top:1in; font-size:8.5pt; color:var(--faint); border-top:1px solid var(--rule); padding-top:.15in }
.toc{ page: frontmatter }
.tocrow{ display:flex; align-items:flex-end; gap:.3em; margin:.42em 0; font-size:10pt }
.toct{ max-width:78% }
.tocby{ color:var(--faint); font-size:8.5pt }
.tocdots{ flex:1; border-bottom:1px dotted #b9b19d; transform:translateY(-2px) }
.tocn a::after{ content: target-counter(attr(href), page); font-variant-numeric:oldstyle-nums }
/* ---------- parts ---------- */
.part{ page: frontmatter; break-before:page; break-after:page; text-align:center; padding-top:2.9in }
.partkind{ font-size:8.5pt; letter-spacing:.26em; text-transform:uppercase; color:var(--rubric); margin-bottom:.35in }
.parttitle{ font-size:22pt; font-weight:var(--headweight); font-family:var(--headfont), "Source Serif 4", serif }
.tocpart{ font-size:8.5pt; letter-spacing:.2em; text-transform:uppercase; color:var(--rubric); font-weight:600; margin:1.1em 0 .3em }
.tocex{ color:var(--faint); font-size:9pt }
/* ---------- articles ---------- */
.article{ page: chapter; break-before:page }
.arthead{ margin:0 0 1.1em; padding-top:.55in }
.artnum{ font-size:30pt; color:var(--rubric); font-variant-numeric:oldstyle-nums; line-height:1 }
.arttitle{ font-size:17pt; margin:.25em 0 0; string-set: arttitle content(text); font-family:var(--headfont), "Source Serif 4", serif; font-weight:var(--headweight) }
.artsub{ font-size:10.5pt; color:var(--faint); font-style:italic; margin:.4em 0 0; text-indent:0; text-align:left }
.artmeta{ font-size:8pt; letter-spacing:.14em; text-transform:uppercase; color:var(--faint);
  margin-top:.7em; border-bottom:1px solid var(--rule); padding-bottom:.7em }
.artbody p.opener{ text-indent:0 }
.artbody p.opener::first-letter{ color:var(--rubric); font-size:3.1em; float:left;
  line-height:.82; padding-right:.08em; font-weight:560 }
.footnote-anchor, .fn{ color:var(--rubric); font-size:.72em; vertical-align:super }
.footnote{ font-size:8.5pt; color:#3a352c }
.footnote-content p{ text-indent:0; text-align:left }
.footnote-container{ border-top:1px solid var(--rule); margin-top:1em; padding-top:.5em }
.srcnotes{ border-top:1px solid var(--rule); margin-top:1.2em; padding-top:.6em; font-size:8.5pt; color:#3a352c }
.srcnotes h2{ font-size:8pt; letter-spacing:.2em; text-transform:uppercase; color:var(--rubric); margin:0 0 .5em }
.srcnotes p{ text-indent:0; text-align:left; hyphens:none; margin:0 0 .35em } .srcnotes ul{ margin:.2em 0 .2em 1em } .srcnotes li{ text-align:left; margin:.15em 0 }
.srcnotes a{ word-break:break-all }
a[data-link]::after{ content: attr(data-link); font-size:.62em; vertical-align:super; color:var(--rubric); margin-left:.05em }
.linknote{ border-top:1px solid var(--rule); margin-top:1.2em; padding-top:.5em; font-size:8.5pt; color:#3a352c; display:grid; grid-template-columns:1fr .95in; gap:.1in }
.linknote h2{ grid-column:1 / -1; font-size:8pt; letter-spacing:.2em; text-transform:uppercase; color:var(--rubric); margin:0 0 .3em }
.linknote ul{ list-style:none; margin:0; padding:0 } .linknote li{ display:grid; grid-template-columns:1.3em 1fr; text-align:left; margin:.12em 0 }
.linknote .lk{ color:var(--rubric); font-size:.8em; vertical-align:super } .linknote .lk-url{ color:var(--faint); font-size:7.5pt; margin-left:.4em; white-space:nowrap }
.linknote .lk-qr{ text-align:center; font-size:6.5pt; color:var(--faint) } .linknote .lk-qr img{ width:.85in; height:.85in; margin:0 auto .05in }
/* ---------- end matter ---------- */
.getmore{ page: frontmatter; break-before:page }
.getmore .qr{ display:flex; gap:.5in; margin:.4in 0 }
.getmore .qr div{ text-align:center; font-size:8.5pt; color:var(--faint) }
.getmore img{ width:1.15in; height:1.15in; margin:0 0 .12in }
.getmore p{ text-indent:0; margin-bottom:.6em }
.getmore .morelinks{ font-size:9pt; color:var(--faint); margin:.4in 0 .2in }
.appendix{ page: frontmatter; break-before:page }
.appendix .appnote{ font-size:8.5pt; color:var(--faint); text-indent:0; margin-bottom:1em }
.apc{ margin:0 0 1.2em; border-top:1px solid var(--rule); padding-top:.8em }
.apc-art{ font-size:8.5pt; letter-spacing:.06em; text-transform:uppercase; color:var(--rubric) }
.apc-body{ margin:.4em 0; font-size:9.5pt }
.apc-by{ font-size:8.5pt; color:var(--faint) }
</style>
</head>
<body data-retrieval-failures="${report.skips.filter(k => /429|5\d\d|timeout|fetch|unreachable/i.test(k.reason)).length}">

${PRINT_INTERIOR ? `<div class="pubsrc" style="height:0;overflow:hidden">${esc(pubName)}</div>` : `<div class="cover">
  <div class="pubsrc">${esc(pubName)}</div>`}
${PRINT_INTERIOR ? "" : `
  <div class="kind">${kindLabel}</div>
  <h1>${esc(pubName)}</h1>
  <div class="rule"></div>
  <div class="dates">${range}</div>
  ${coverPlate ? `<div class="coverplate"><img src="${coverPlate.path}" alt=""></div>` : ""}
  <div class="foot"><span>${full.length} ${noun}</span><span>${host.replace(/^www\./, "")}</span></div>
</div>`}

<div class="fm halftitle">${esc(pubName)}</div>

<div class="fm titlepage">
  <div class="t">${esc(pubName)}</div>
  <div class="s">${(() => { const VL = argOf("--vol-label"), VO = argOf("--vol-of"); const one = /^(\w+ \d{4}) – \1$/.exec(range); const r = one ? one[1] : range;
    return VL ? `${VO ? `Vol. ${VO} · ` : ""}${r}` : `${volLabel} · ${r}`; })()}</div>
  ${(multi || author.toLowerCase() !== pubName.toLowerCase()) ? `<div class="a">${esc(authorLine)}</div>` : ""}
</div>

<div class="fm about">
  <h3>About</h3>
  ${pubDesc ? `<p class="epigraph">${esc(pubDesc)}</p>` : ""}
  ${(() => { const lost = report.skips.filter(k => /429|5\d\d|timeout|fetch|unreachable/i.test(k.reason)).length;
     report.retrievalFailures = lost; return ""; })()}
  ${report.selection ? `<p>This volume holds the ${full.length} ${noun} readers responded to most,
  chosen by reactions from the ${report.selection.from} published at ${host.replace(/^www\./, "")}
  over ${typeof archiveRange !== "undefined" ? archiveRange : range}, printed in the order they first appeared.</p>` : (() => {
    /* the accounting invariant (Codex audit P1-4): eligible = included + rule cuts + editor exclusions + guest cuts + retrieval failures; "every" only when nothing was left out */
    const eligible = report.eligiblePublic || 0, cuts = (report.ruleCuts || []).length + (report.guestCuts || []).length + (report.editorExcluded || 0) + (report.retrievalFailures || 0);
    const every = eligible > 0 && eligible === full.length && cuts === 0;
    return `<p>This volume collects ${every ? "every public" : `${full.length} of the ${eligible || full.length + cuts} public`} ${every ? noun : noun} published at ${host.replace(/^www\./, "")} from
  ${range}${author.toLowerCase() !== pubName.toLowerCase() ? `, written by ${esc(multi ? authorLine.replace(/^Essays by /, "") : author)}` : ""}: ${full.length} ${noun},
  ${totalWords.toLocaleString("en-US")} words, in the order they first appeared.${cuts ? ` ${cuts === 1 ? "One piece is" : cuts + " pieces are"} not included${(report.editorExcluded || 0) ? ", " + ((report.editorExcluded === 1) ? "one" : report.editorExcluded) + " by the editor's choice" : ""}; the reasons follow.` : ""}</p>`; })()}
  ${report.retrievalFailures ? `<p>${report.retrievalFailures} ${report.retrievalFailures === 1 ? nounOne : noun} could not be
  retrieved while this proof was built and will appear in the production edition.</p>` : ""}
  ${report.mediaOnly ? `<p>${report.mediaOnly} ${report.mediaOnly === 1 ? "piece is a video or audio conversation and lives" : "pieces are video or audio conversations and live"} in the online edition.</p>` : ""}
  ${report.omittedPaid ? `<p>${report.omittedPaid} paid ${report.omittedPaid === 1 ? nounOne + " is" : noun + " are"} not
  included in this public-archive proof; the production edition adds them through the author's own export.</p>` : ""}
  ${report.ruleCuts.length ? `<p>${report.ruleCuts.length === 1 ? "One piece was" : report.ruleCuts.length + " pieces were"} left out by rule: ${(() => { const by = {}; for (const c of report.ruleCuts) by[c.reason] = (by[c.reason] || 0) + 1; return Object.entries(by).map(([r, n]) => n > 1 ? `${n} ${r.replace(/^an? /, "")}s` : r).join(", "); })()}.</p>` : ""}
  ${report.guestCuts.length ? `<p>${report.guestCuts.length === 1 ? "One guest post is" : report.guestCuts.length + " guest posts are"} not included, because a guest owns their piece: ${report.guestCuts.map(g => `“${esc(g.title)}” by ${esc(g.by)}`).join("; ")}.</p>` : ""}
  <p>Everything here was written for the screen and is reset for paper. Linked words carry a
  small letter, and each essay ends with its links as short addresses and a code to the essay
  online. Source notes the author wrote into an essay stay with it. Web-only embeds become
  printed source notes; media-only pieces remain in the online edition.</p>
  <div class="colophon">${ISBN ? `ISBN ${esc(ISBN)} · ` : ""}Set in ${esc(B.bodyFont)} · 6 × 9 in, 60# uncoated${BW ? ", black-ink interior (images shown as they print)" : ""} ·
  © ${year} ${esc(brand?.copyright || author)}. All rights remain with the author.</div>
</div>

${DEDICATION ? `<div class="fm dedication">${esc(DEDICATION)}</div>` : ""}
<div class="fm toc">
  <h3>Contents</h3>
  ${tocRows}
</div>

${await withLinkNotes(articles)}

${commentPicks.length ? `<div class="fm appendix">
  <h3>From the comments</h3>
  <p class="appnote">Readers' replies as published on the online edition; each links from the ${nounOne} it answers.</p>
  ${commentPicks.map(c => `<div class="apc">
    <div class="apc-art">On “${esc(c.article)}”</div>
    <blockquote class="apc-body">${esc(c.body)}${c.truncated ? "…" : ""}</blockquote>
    <div class="apc-by">${esc(c.name)}${c.likes ? ` · ${c.likes} ❤` : ""}</div>
  </div>`).join("\n")}
</div>` : ""}

<div class="getmore">
  <h3>Get more</h3>
  <p><b>Read on.</b> New essays appear first at ${host.replace(/^www\./, "")}. A free subscription
  delivers each new piece by email, and the paid archive lives there too.</p>
  <p><b>Order copies.</b> If the author has set up a page for this book at Lulu, the short link and
  code below lead to it; Lulu prints each copy on demand at cost and ships it. If not, this copy was
  printed for the author.</p>
  ${homeLinks.length ? `<div class="morelinks"><b>More from ${esc(pubName)}.</b> ${homeLinks.map(l =>
    `${esc(l.title || l.url)} (${esc(String(l.url || "").replace(/^https?:\/\//, "").split("?")[0].replace(/\/$/, "").slice(0, 60))})`).join(" · ")}</div>` : ""}
  <div class="qr">
    <div><img src="${qrPub}" alt="QR: publication"><br>${host}</div>
    <div><img src="${qrInk}" alt="QR: inksheaf"><br>inksheaf.com</div>
  </div>
  <p style="margin-top:.5in; font-size:8.5pt; color:var(--faint)">Printed and bound as a proof by
  Inksheaf, an independent service for Substack writers, not affiliated with Substack Inc.
  Corrections: caithrin@caithrin.com.</p>
</div>

<script>
window.__pagedDone = new Promise(res => {
  window.PagedConfig = { auto: true, after: (flow) => { window.__pageCount = flow.total; res(flow.total); } };
});
</script>
<script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"></script>
</body>
</html>`;

// image localization: download once into the cache, convert to grayscale for BW proofs,
// rewrite to relative paths (renders become network-independent; dead images get honest boxes)
const { execFileSync: execF } = await import("node:child_process");
const crypto = await import("node:crypto");
const IMGCACHE = "proofs/.cache/img";
mkdirSync(IMGCACHE, { recursive: true });
const { relative: relPath, dirname: dirN } = await import("node:path");
const OUTDIR = dirN(OUT);
const srcs = [...new Set([...html.matchAll(/<img src="(http[^"]+)"/g)].map(m => m[1]))];
let htmlOut = html;
const queue = [...srcs];
async function worker() {
  while (queue.length) {
    const u = queue.pop();
    const h = crypto.createHash("sha1").update(u).digest("hex").slice(0, 16);
    const ext = /f_jpg|\.jpe?g/i.test(u) ? "jpg" : /\.png/i.test(u) ? "png" : "img";
    const base = `${IMGCACHE}/${h}.${ext}`;
    const gray = `${IMGCACHE}/${h}-gray.${ext}`;
    const want = BW ? gray : base;
    try {
      const { existsSync: ex, writeFileSync: wf } = await import("node:fs");
      if (!ex(base)) {
        const r = await fetch(u, { headers: { "user-agent": UA["user-agent"] } });
        if (!r.ok) throw new Error(r.status);
        wf(base, Buffer.from(await r.arrayBuffer()));
      }
      /* print mode: originals over 2700 px wide are resampled (300 ppi across the text block is
         1350 px) so the interior stays sharp and small; the resampled file replaces the base */
      if (MODE === "print" && !ex(base + ".rs")) {
        try { execF("python3", ["scripts/resample-image.py", base, base + ".tmp", "2700"], { stdio: "pipe" }); execF("mv", [base + ".tmp", base]);
          if (ex(gray)) execF("rm", [gray]); /* the grey copy was made from the old file */ } catch (e) { report.resampleFailed = (report.resampleFailed || 0) + 1; }
        wf(base + ".rs", "1");
      }
      if (BW && !ex(gray)) {
        try {
          execF("sips", ["-m", "/System/Library/ColorSync/Profiles/Generic Gray Profile.icc",
            base, "--out", gray], { stdio: "pipe" });
        } catch { execF("cp", [base, gray]); }
      }
      htmlOut = htmlOut.replaceAll(`<img src="${u}"`, `<img src="${relPath(OUTDIR, want)}"`);
    } catch (e) {
      report.deadImages.push(u.slice(0, 120));
      const quoted = u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      htmlOut = htmlOut.replace(new RegExp(`<img src="${quoted}"[^>]*>`, "g"),
        `<div class="imgmissing">An image could not be retrieved for this proof.</div>`);
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
report.deadImages.sort();

mkdirSync("proofs", { recursive: true });
writeFileSync(OUT, htmlOut);
/* --engine typst (or BOOK_ENGINE=typst): the same document, emitted as a Typst book beside the
   HTML; render-book.sh compiles it. --notes footnotes|endnotes_per_article (the plan's policy). */
const ENGINE = argOf("--engine") || process.env.BOOK_ENGINE || "paged";
if (ENGINE === "typst") {
  const { emitTypst } = await import("./lib/typst-emit.mjs");
  const { dirname } = await import("node:path");
  /* --fit-figs slug:3=2.1,other:1=3.4 : figures the fit loop asks to scale to a height (inches) */
  const fitFigs = Object.fromEntries(String(argOf("--fit-figs") || "").split(",").filter(Boolean).map(x => { const i = x.lastIndexOf("="); return [x.slice(0, i), Number(x.slice(i + 1))]; }).filter(([k, v]) => k && v > 0));
  const typ = emitTypst(htmlOut, { baseDir: dirname(OUT), notes: argOf("--notes") || "endnotes_per_article", pubName, fitFigs, host: host.replace(/^www\./, "") });
  if (Object.keys(fitFigs).length) report.fitFigs = fitFigs;
  writeFileSync(OUT.replace(/\.html$/, ".typ"), typ);
  report.engine = "typst"; report.notes = argOf("--notes") || "endnotes_per_article";
} else report.engine = "paged";
{ // the printed span, from the posts actually included (consumers: pipeline copy/cover steps)
  const ds = full.map(a => a.post_date || a.date).filter(Boolean).sort();
  if (ds.length) report.dateRange = [String(ds[0]).slice(0, 10), String(ds[ds.length - 1]).slice(0, 10)];
}
writeFileSync(OUT.replace(/\.html$/, ".report.json"), JSON.stringify(report, null, 2));
console.error("wrote", OUT, "articles:", full.length, "words:", totalWords,
  "| skips:", report.skips.length, "| dead images:", report.deadImages.length,
  "| paid omitted:", report.omittedPaid, "| decline:", report.declineSignals.join(",") || "none");
