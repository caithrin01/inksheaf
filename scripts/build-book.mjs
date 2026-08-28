#!/usr/bin/env node
// Build a proof PDF book (HTML for Paged.js) from a Substack publication's public archive.
// v0 of the plan's Phase-2 renderer. Usage:
//   node scripts/build-book.mjs <publication-url> [--out proofs/name.html]
// Honest limits (recorded in evidence): footnotes render as per-article endnotes;
// images stay RGB; embeds become source cards. Proofs are watermarked.

import { writeFileSync, mkdirSync } from "node:fs";
import QRCode from "qrcode";

const RAW = process.argv[2] || "https://www.caithrin.com";
const OUT = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : "proofs/book.html";

const UA = { "user-agent": "Mozilla/5.0 inksheaf-proof/0.1", accept: "application/json" };
const MODE = process.argv.includes("--images-print") ? "print" : "proof";
let host = new URL(RAW.includes("://") ? RAW : "https://" + RAW).hostname;

/* ---------------- fetch ---------------- */
async function j(url) {
  for (let a = 0; a < 3; a++) {
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

console.error("fetching archive for", host);
const listing = [];
for (let offset = 0; ; offset += 25) {
  const page = await j(`https://${host}/api/v1/archive?sort=new&offset=${offset}&limit=25`);
  if (!Array.isArray(page) || !page.length) break;
  listing.push(...page);
  if (listing.length > 400) break;
  await new Promise(r => setTimeout(r, 400));
}
const report = { host, listed: listing.length, skips: [], deadImages: [],
  omittedPaid: 0, podcastPosts: 0, declineSignals: [] };
report.omittedPaid = listing.filter(p => p.audience && p.audience !== "everyone").length;
report.podcastPosts = listing.filter(p => p.type === "podcast").length;
if (report.podcastPosts > listing.length / 2) report.declineSignals.push("podcast-first publication");
const shortPosts = listing.filter(p => (p.wordcount || 0) < 150).length;
if (shortPosts > listing.length * 0.6) report.declineSignals.push("thread/notes-style publication");
const posts = listing
  .filter(p => p.audience === "everyone" && (p.type === "newsletter" || !p.type)
    && p.is_published !== false && !p.restacked_post_id)
  .sort((a, b) => Date.parse(a.post_date) - Date.parse(b.post_date));
console.error(listing.length, "listed;", posts.length, "printable;", report.omittedPaid, "paid omitted");

const full = [];
for (const p of posts) {
  try {
    const d = await j(`https://${host}/api/v1/posts/${encodeURIComponent(p.slug)}`);
    if (d.body_html && d.body_html.length <= 2_000_000) full.push(d);
    else report.skips.push({ slug: p.slug, reason: d.body_html ? "body over 2MB" : "empty body" });
  } catch (e) { report.skips.push({ slug: p.slug, reason: String(e.message) }); }
  await new Promise(r => setTimeout(r, 350));
}
console.error(full.length, "bodies fetched");

// publication meta from homepage
const home = await text(`https://${host}`);
const pubName = (home.match(/property="og:site_name" content="([^"]+)"/) || [])[1]
  || full[0]?.publishedBylines?.[0]?.name || host.split(".")[0];
let pubDesc = (home.match(/property="og:description" content="([^"]+)"/) || [])[1] || "";
pubDesc = pubDesc.replace(/\s*Click to read.*$/i, "").trim();
const byCount = {};
for (const p2 of full) { const n = p2.publishedBylines?.[0]?.name; if (n) byCount[n] = (byCount[n] || 0) + 1; }
const authors = Object.entries(byCount).sort((a, b) => b[1] - a[1]).map(([n]) => n);
const multi = authors.length > 1;
const author = authors[0] || pubName;
const authorLine = multi
  ? "Essays by " + authors.slice(0, 6).join(", ") + (authors.length > 6 ? ` and ${authors.length - 6} others` : "")
  : author;

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
function clean(html, slug) {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
       .replace(/<form[\s\S]*?<\/form>/gi, "");
  s = s.replace(/<div[^>]*class="[^"]*image-link-expand[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "");
  s = s.replace(/<button[\s\S]*?<\/button>/gi, "");
  s = s.replace(/<p[^>]*>\s*<a[^>]*>(Leave a comment|Share|Subscribe now|Refer a friend|Give a gift subscription)<\/a>\s*<\/p>/gi, "");
  s = s.replace(/<a[^>]*>(Leave a comment|Subscribe now|Share this post|Refer a friend)<\/a>/gi, "");
  s = s.replace(/<img[^>]*(width="1"|height="1")[^>]*>/gi, "");
  s = s.replace(/<source[^>]*>/gi, "");
  for (const re of KILL) s = s.replace(re, "");
  // iframes and embeds become source cards
  s = s.replace(/<iframe[^>]*src="([^"]+)"[\s\S]*?<\/iframe>/gi,
    (_, src) => `<div class="embedcard">Viewable online: <span>${src.slice(0, 90)}</span></div>`);
  s = s.replace(/<div[^>]*class="[^"]*tweet[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi,
    `<div class="embedcard">A post from X, viewable in the online edition.</div>`);
  // images: proof mode keeps Substack CDN JPEGs (small); print mode uses decoded S3 originals
  s = s.replace(/<img[^>]+>/gi, tag => {
    const src = (tag.match(/src="([^"]+)"/) || [])[1] || "";
    const alt = (tag.match(/alt="([^"]*)"/) || [])[1] || "";
    if (!src) return "";
    const out = MODE === "print" ? decodeCdn(src) : src.replace(/w_\d+/, "w_1100").replace("f_auto", "f_jpg").replace("q_auto:good", "q_80").replace(",fl_progressive:steep", "");
    return `<img src="${out}" alt="${alt}">`;
  });
  // anchors: keep text, drop link boxes styling issues; footnote anchors keep their number
  s = s.replace(/<a([^>]*class="footnote-anchor"[^>]*)>/gi, "<a$1 class=\"fn\">");
  // namespace footnote ids per article so links stay unique
  s = s.replaceAll('id="footnote-', `id="fn-${slug}-`)
       .replaceAll('href="#footnote-', `href="#fn-${slug}-`);
  // verse: paragraphs with manual line breaks set ragged, unindented, unhyphenated
  s = s.replace(/<p([^>]*)>((?:(?!<\/p>)[\s\S])*<br[\s\S]*?)<\/p>/gi,
    (m, attrs, inner) => `<p${attrs.includes('class="') ? attrs.replace('class="', 'class="verse ') : attrs + ' class="verse"'}>${inner}</p>`);
  // GIFs print one frame; say so
  s = s.replace(/<img src="([^"]+\.gif[^"]*)"([^>]*)>/gi,
    '<img src="$1"$2><div class="gifnote">Animation; one frame printed. The moving version is in the online edition.</div>');
  return s;
}

/* ---------------- QR codes ---------------- */
const qrPub = await QRCode.toDataURL(`https://${host}`, { margin: 0, width: 220, color: { dark: "#221d16", light: "#0000" } });
const qrInk = await QRCode.toDataURL("https://inksheaf.pages.dev", { margin: 0, width: 220, color: { dark: "#221d16", light: "#0000" } });

/* ---------------- assemble ---------------- */
const dates = full.map(p => Date.parse(p.post_date)).sort((a, b) => a - b);
const dfmt = t => new Date(t).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const dayfmt = t => new Date(t).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const range = `${dfmt(dates[0])} – ${dfmt(dates[dates.length - 1])}`;
const year = new Date(dates[dates.length - 1]).getUTCFullYear();
const y0 = new Date(dates[0]).getUTCFullYear();
const spanMonths = (dates[dates.length - 1] - dates[0]) / 2629800000;
const kindLabel = spanMonths <= 4 ? `Quarterly · ${year}`
  : (spanMonths >= 10 && spanMonths <= 14) ? `Annual · ${year}`
  : `Collected Essays · ${y0 === year ? year : y0 + "–" + year}`;
const volLabel = spanMonths <= 4 ? `The ${year} Quarterly` : (spanMonths >= 10 && spanMonths <= 14) ? `The ${year} Annual` : `Collected Essays`;
const totalWords = full.reduce((s, p) => s + (p.wordcount || 0), 0);

const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const tocRows = full.map((p, i) => {
  const b = multi ? p.publishedBylines?.[0]?.name : null;
  return `<div class="tocrow"><span class="toct"><a href="#art-${i}">${esc(p.title)}</a>${b ? `<span class="tocby"> · ${esc(b)}</span>` : ""}</span><span class="tocdots"></span><span class="tocn"><a href="#art-${i}"></a></span></div>`;
}).join("\n");

const articles = full.map((p, i) => `
<section class="article" id="art-${i}">
  <header class="arthead">
    <div class="artnum">${i + 1}</div>
    <h2 class="arttitle" data-title="${esc(p.title)}">${esc(p.title)}</h2>
    ${p.subtitle ? `<p class="artsub">${esc(p.subtitle)}</p>` : ""}
    <div class="artmeta">${dayfmt(Date.parse(p.post_date))} · ${(p.wordcount || 0).toLocaleString("en-US")} words${(() => { const b = p.publishedBylines?.[0]?.name; return b && (multi || b !== author) ? " · by " + esc(b) : ""; })()}</div>
  </header>
  <div class="artbody">${clean(p.body_html, p.slug)}</div>
</section>`).join("\n");

const langs = {};
for (const p2 of full) if (p2.language) langs[p2.language] = (langs[p2.language] || 0) + 1;
const lang = Object.entries(langs).sort((a, b) => b[1] - a[1])[0]?.[0] || "en";
const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${esc(pubName)} — ${year} Annual (Inksheaf proof)</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,300..700;1,8..60,300..700&display=swap" rel="stylesheet">
<style>
:root{ --ink:#221d16; --rubric:#a63a2b; --faint:#6d675c; --rule:#d8d2c2; }
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
body{ font-family:"Source Serif 4", Georgia, serif; color:var(--ink); line-height:1.5;
  font-optical-sizing:auto; margin:0 }
.pubsrc{ string-set: pubname content(text); height:0; overflow:hidden; visibility:hidden }
p{ margin:0 0 0 0; text-indent:1.35em; text-align:justify; hyphens:auto; orphans:2; widows:2 }
.artbody > p:first-of-type{ text-indent:0 }
.about p, .getmore p{ text-indent:0 }
a{ color:inherit; text-decoration:none }
img{ max-width:100%; height:auto; display:block; margin:.9em auto }
figure{ margin:1em 0 } figcaption{ font-size:8.5pt; color:var(--faint); text-align:center; margin-top:.35em }
blockquote{ margin:.9em 1.4em; font-size:9.8pt; color:#3a352c }
h1,h2,h3,h4{ line-height:1.15; font-weight:560 }
hr{ border:0; text-align:center; margin:1.2em 0 }
hr::after{ content:"❦"; color:var(--rubric); font-size:10pt }
ul,ol{ margin:.7em 0 .7em 1.5em; padding:0 }
li{ margin:.2em 0; text-align:justify }
pre{ font-size:8pt; background:#f4efe4; padding:.6em; overflow:hidden; white-space:pre-wrap; word-break:break-word }
code{ font-size:8.5pt }
p.verse{ text-align:left; text-indent:0; hyphens:none }
.gifnote{ font-size:7.5pt; color:var(--faint); text-align:center; margin:-.5em 0 .9em }
table{ width:100%; border-collapse:collapse; font-size:8pt; margin:.9em 0 }
td, th{ border:1px solid var(--rule); padding:.25em .4em; word-break:break-word; text-align:left }
.imgmissing{ border:1px dashed var(--rubric); color:var(--faint); font-size:8.5pt; padding:1em; text-align:center; margin:.9em 0 }
.embedcard{ border:1px solid var(--rule); border-left:3px solid var(--rubric); padding:.6em .8em;
  font-size:8.5pt; color:var(--faint); margin:.9em 0; word-break:break-all }
/* watermark on every page */
.pagedjs_page::after, .pagedjs_pagebox::after{ content:"PROOF · NOT FOR SALE"; position:absolute; top:50%; left:50%;
  transform:translate(-50%,-50%) rotate(-38deg); font-family:"Source Serif 4"; font-size:26pt;
  letter-spacing:.3em; color:rgba(166,58,43,.14); pointer-events:none; white-space:nowrap; z-index:99 }

/* ---------- front matter ---------- */
.cover{ page: cover; height:100%; position:relative; background:#f6f1e6;
  padding:1.1in .85in; box-sizing:border-box; break-after:page }
.cover .kind{ font-size:9pt; letter-spacing:.3em; text-transform:uppercase; color:var(--rubric); font-weight:600 }
.cover h1{ font-size:34pt; margin:.35in 0 0; letter-spacing:-.01em }
.cover .rule{ width:.55in; border-bottom:3px solid var(--rubric); margin:.28in 0 }
.cover .dates{ font-size:11pt; color:var(--faint) }
.cover .foot{ position:absolute; bottom:.9in; left:.85in; right:.85in; border-top:1px solid var(--rule);
  padding-top:.16in; display:flex; justify-content:space-between; font-size:8.5pt; color:var(--faint) }
.fm{ page: frontmatter; break-after:page }
.halftitle{ text-align:center; padding-top:2.6in; font-size:15pt; letter-spacing:.04em }
.titlepage{ text-align:center; padding-top:1.9in }
.titlepage .t{ font-size:24pt; font-weight:560 }
.titlepage .s{ font-size:10.5pt; color:var(--faint); margin-top:.22in }
.titlepage .a{ margin-top:.75in; font-size:11pt }
.titlepage .imprint{ margin-top:1.55in; font-size:8.5pt; letter-spacing:.18em; text-transform:uppercase; color:var(--faint) }
.about h3, .toc h3, .getmore h3{ font-size:9pt; letter-spacing:.26em; text-transform:uppercase;
  color:var(--rubric); font-weight:600; margin:0 0 .3in }
.about p{ text-indent:0; margin-bottom:.6em }
.about .epigraph{ color:var(--faint); font-size:11.5pt; margin:0 0 1.1em; padding-left:.8em; border-left:2.5px solid var(--rubric) }
.about .colophon{ margin-top:1in; font-size:8.5pt; color:var(--faint); border-top:1px solid var(--rule); padding-top:.15in }
.toc{ page: frontmatter }
.tocrow{ display:flex; align-items:baseline; gap:.3em; margin:.42em 0; font-size:10pt }
.toct{ max-width:78% }
.tocby{ color:var(--faint); font-size:8.5pt }
.tocdots{ flex:1; border-bottom:1px dotted #b9b19d; transform:translateY(-2px) }
.tocn a::after{ content: target-counter(attr(href), page); font-variant-numeric:oldstyle-nums }
/* ---------- articles ---------- */
.article{ page: chapter; break-before:page }
.arthead{ margin:0 0 1.1em; padding-top:.55in }
.artnum{ font-size:30pt; color:var(--rubric); font-variant-numeric:oldstyle-nums; line-height:1 }
.arttitle{ font-size:17pt; margin:.25em 0 0; string-set: arttitle content(text) }
.artsub{ font-size:10.5pt; color:var(--faint); font-style:italic; margin:.4em 0 0; text-indent:0; text-align:left }
.artmeta{ font-size:8pt; letter-spacing:.14em; text-transform:uppercase; color:var(--faint);
  margin-top:.7em; border-bottom:1px solid var(--rule); padding-bottom:.7em }
.artbody > p:first-of-type::first-letter{ color:var(--rubric); font-size:3.1em; float:left;
  line-height:.82; padding-right:.08em; font-weight:560 }
.footnote-anchor, .fn{ color:var(--rubric); font-size:.72em; vertical-align:super }
.footnote{ font-size:8.5pt; color:#3a352c }
.footnote-content p{ text-indent:0; text-align:left }
.footnote-container{ border-top:1px solid var(--rule); margin-top:1em; padding-top:.5em }
/* ---------- end matter ---------- */
.getmore{ page: frontmatter; break-before:page }
.getmore .qr{ display:flex; gap:.5in; margin:.4in 0 }
.getmore .qr div{ text-align:center; font-size:8.5pt; color:var(--faint) }
.getmore img{ width:1.15in; height:1.15in; margin:0 0 .12in }
.getmore p{ text-indent:0; margin-bottom:.6em }
</style>
</head>
<body>

<div class="cover">
  <div class="pubsrc">${esc(pubName)}</div>
  <div class="kind">${kindLabel}</div>
  <h1>${esc(pubName)}</h1>
  <div class="rule"></div>
  <div class="dates">${range}</div>
  <div class="foot"><span>${full.length} essays · ${totalWords.toLocaleString("en-US")} words</span><span>INKSHEAF EDITION</span></div>
</div>

<div class="fm halftitle">${esc(pubName)}</div>

<div class="fm titlepage">
  <div class="t">${esc(pubName)}</div>
  <div class="s">${volLabel} · ${range}</div>
  ${(multi || author !== pubName) ? `<div class="a">${esc(authorLine)}</div>` : ""}
  <div class="imprint">Printed by Inksheaf</div>
</div>

<div class="fm about">
  <h3>About</h3>
  ${pubDesc ? `<p class="epigraph">${esc(pubDesc)}</p>` : ""}
  <p>This volume collects every public essay published at ${host.replace(/^www\./, "")} from
  ${range}${author !== pubName ? `, written by ${esc(multi ? authorLine.replace(/^Essays by /, "") : author)}` : ""}: ${full.length} pieces,
  ${totalWords.toLocaleString("en-US")} words, in the order they first appeared.</p>
  ${report.omittedPaid ? `<p>${report.omittedPaid} paid ${report.omittedPaid === 1 ? "essay is" : "essays are"} not
  included in this public-archive proof; the production edition adds them through the author's own export.</p>` : ""}
  <p>Everything here was written for the screen and is reset for paper. Links print as
  references. Video, audio and interactive embeds appear as cards that point to the online
  edition.</p>
  <div class="colophon">Set in Source Serif 4 · 6 × 9 in, 60# uncoated · Proof edition, not for sale ·
  © ${year} ${esc(author)}. All rights remain with the author.</div>
</div>

<div class="fm toc">
  <h3>Contents</h3>
  ${tocRows}
</div>

${articles}

<div class="getmore">
  <h3>Get more</h3>
  <p><b>Read on.</b> New essays appear first at ${host.replace(/^www\./, "")}. A free subscription
  delivers each new piece by email, and the paid archive lives there too.</p>
  <p><b>Order copies.</b> This edition, and each new quarterly or annual, can be ordered at the
  publication's Inksheaf page. Gift copies ship to any US address.</p>
  <div class="qr">
    <div><img src="${qrPub}" alt="QR: publication"><br>${host}</div>
    <div><img src="${qrInk}" alt="QR: inksheaf"><br>inksheaf.com</div>
  </div>
  <p style="margin-top:.5in; font-size:8.5pt; color:var(--faint)">Printed and bound as a proof by
  Inksheaf, an independent service for Substack writers, not affiliated with Substack Inc.
  Corrections: hello@inksheaf.com.</p>
</div>

<script>
window.__pagedDone = new Promise(res => {
  window.PagedConfig = { auto: true, after: (flow) => { window.__pageCount = flow.total; res(flow.total); } };
});
</script>
<script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"></script>
</body>
</html>`;

// dead-image scan (unique srcs, concurrency 6)
const srcs = [...new Set([...html.matchAll(/<img src="(http[^"]+)"/g)].map(m => m[1]))];
let htmlOut = html;
const queue = [...srcs];
async function worker() {
  while (queue.length) {
    const u = queue.pop();
    try {
      const r = await fetch(u, { method: "HEAD", headers: { "user-agent": UA["user-agent"] } });
      if (!r.ok) throw new Error(r.status);
    } catch (e) {
      report.deadImages.push(u.slice(0, 120));
      htmlOut = htmlOut.replaceAll(`<img src="${u}"`,
        `<div class="imgmissing">An image could not be retrieved for this proof.</div><img style="display:none" src="${u}"`);
    }
  }
}
await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);

mkdirSync("proofs", { recursive: true });
writeFileSync(OUT, htmlOut);
writeFileSync(OUT.replace(/\.html$/, ".report.json"), JSON.stringify(report, null, 2));
console.error("wrote", OUT, "articles:", full.length, "words:", totalWords,
  "| skips:", report.skips.length, "| dead images:", report.deadImages.length,
  "| paid omitted:", report.omittedPaid, "| decline:", report.declineSignals.join(",") || "none");
