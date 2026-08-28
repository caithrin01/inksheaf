#!/usr/bin/env node
// Proof lint: reads a generated book and judges the parts INKSHEAF wrote (front/back matter,
// labels, structure) before any human sees them. Two layers:
//   1. Deterministic checks: template degeneracy, unfilled slots, boilerplate leakage, structure.
//   2. Optional LLM read (--llm): pipes the generated prose to `claude -p` for an editorial verdict.
// Usage: node scripts/proof-lint.mjs proofs/book.html [--llm]
// Exit 0 clean, 1 findings. Author essay content is never judged; only what the template produced.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const file = process.argv[2];
const useLLM = process.argv.includes("--llm");
if (!file || !existsSync(file)) { console.error("usage: proof-lint.mjs <book.html> [--llm]"); process.exit(2); }
const html = readFileSync(file, "utf-8");

const findings = [];
const warn = [];

/* ---------- extract the template-authored regions ---------- */
function region(re, name) {
  const m = html.match(re);
  if (!m) return null;
  const flat = m[0].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const marked = m[0].replace(/<p class="epigraph">/gi, '\n[author tagline, quoted verbatim, do not judge] ');
  const lines = marked.replace(/<(p|div|h\d|dt|dd|li)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")
    .split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  return { name, html: m[0], text: flat, lines };
}
const regions = [
  region(/<div class="cover">[\s\S]*?<\/div>\s*<div class="fm/, "cover"),
  region(/<div class="fm titlepage">[\s\S]*?<\/div>\s*<div class="fm about"/, "titlepage"),
  region(/<div class="fm about">[\s\S]*?<\/div>\s*<div class="fm toc"/, "about"),
  region(/<div class="getmore">[\s\S]*?<\/div>\s*<script/, "getmore"),
].filter(Boolean);

/* ---------- 1. degenerate repetition in generated sentences ---------- */
for (const r of regions) {
  for (const line of r.lines) {
  for (const sentence of line.split(/(?<=[.!?])\s+/)) {
    const noUrls = sentence.replace(/\S+\.(com|org|net|io|app|co)\S*/gi, " ");
    const words = noUrls.toLowerCase().match(/[a-z][a-z'-]{3,}/g) || [];
    const counts = {};
    for (const w of words) counts[w] = (counts[w] || 0) + 1;
    for (const [w, n] of Object.entries(counts))
      if (n >= 3 && !["essays", "words", "pages", "public"].includes(w))
        findings.push(`${r.name}: "${w}" appears ${n}x in one sentence: "${sentence.slice(0, 110)}"`);
  }
  }
}

/* ---------- 2. unfilled slots and code leakage ---------- */
for (const bad of ["undefined", "[object Object]", "NaN", "${", "%%", "lorem ipsum", "TODO", "PLACEHOLDER"]) {
  for (const r of regions)
    if (r.text.includes(bad)) findings.push(`${r.name}: template leakage "${bad}"`);
}
if (/>\s*null\s*</.test(html)) findings.push("bare 'null' rendered somewhere in the book");

/* ---------- 3. platform boilerplate that must never print ---------- */
for (const b of ["Click to read", "Subscribe now", "Share this post", "Leave a comment",
                 "Upgrade to paid", "Refer a friend", "a Substack publication"]) {
  // element text only (">Leave a comment<"), exact case: author prose is never flagged
  const n = (html.match(new RegExp(">\\s*" + b.replace(/ /g, "\\s+") + "\\s*<", "g")) || []).length;
  if (n) findings.push(`platform boilerplate "${b}" appears ${n}x as element text`);
}

/* ---------- 3b. editorial standards (docs/BOOK-QUALITY.md) ---------- */
// "every public X" may not be claimed over retrieval failures
const lostM = html.match(/data-retrieval-failures="(\d+)"/);
if (lostM && +lostM[1] > 0 && /collects every public/.test(html))
  findings.push(`About claims "every public" while ${lostM[1]} pieces failed retrieval`);
// double-escaped entities are shipped bugs
if (/&amp;(#|amp;|quot;|lt;|gt;|apos;)/.test(html))
  findings.push("double-escaped entity printing literally (e.g. &amp;#x27;)");
// the printer's mark stays off the front of the book
for (const r of regions.filter(r2 => ["cover", "titlepage", "about"].includes(r2.name)))
  if (/inksheaf/i.test(r.text)) findings.push(`${r.name}: Inksheaf mark on the front of the book (imprint belongs in back matter, once)`);
// a TOC of bare dates is not navigation
const tocHtml = (html.match(/<div class="fm toc">[\s\S]*?<\/div>\s*(<section|<div class="get)/) || [""])[0];
const rowLabels = [...tocHtml.matchAll(/<span class="toct">([\s\S]*?)<\/span>/g)].map(m => m[1].replace(/<[^>]+>/g, " ").trim());
const dateRows = rowLabels.filter(t => /^[A-Z][a-z]+ \d{1,2},? \d{4}\s*$/.test(t)).length;
if (rowLabels.length && dateRows / rowLabels.length > 0.4 && !/class="tocpart"/.test(html))
  findings.push(`TOC is ${dateRows}/${rowLabels.length} bare dates with no part grouping`);
// bylines mark exceptions, not the norm
const byCountToc = (html.match(/class="tocby"/g) || []).length;
if (rowLabels.length && byCountToc / rowLabels.length > 0.5 && byCountToc < rowLabels.length)
  findings.push(`TOC bylines on ${byCountToc}/${rowLabels.length} rows: mark minority authors only, or all in a true group publication`);

/* ---------- 4. structure sanity ---------- */
const tocRows = (html.match(/class="tocrow"/g) || []).length;
const articles = (html.match(/class="article" id="art-/g) || []).length;
if (!tocRows) findings.push("contents has zero rows");
if (tocRows !== articles) findings.push(`contents rows (${tocRows}) != articles (${articles})`);
// watermark removed by decision 2026-08-28 (community project); imprint line is the only mark
const maxYear = new Date().getFullYear() + 1;
for (const r of regions) {
  const years = [...r.text.matchAll(/\b(19|20)\d{2}\b/g)].map(m => +m[0]);
  if (years.some(y => y > maxYear)) findings.push(`${r.name}: a year beyond next year in generated matter`);
}
const emptyMast = /<div class="cv-mast">\s*<\/div>|<h1>\s*<\/h1>/.test(html);
if (emptyMast) findings.push("empty masthead/title element");

/* ---------- 5. orphan punctuation in generated regions ---------- */
for (const r of regions)
  if (/(\s[·,;:]\s*[·,;:])|,,|\s\./.test(r.text)) findings.push(`${r.name}: orphan punctuation: "${r.text.match(/.{0,40}((\s[·,;:]\s*[·,;:])|,,|\s\.).{0,20}/)?.[0]}"`);

/* ---------- 6. optional LLM editorial judge ---------- */
if (useLLM && regions.length) {
  const prose = regions.map(r => `[${r.name}]\n` + r.lines.map(l => "  " + l).join("\n")).join("\n\n");
  const prompt = `You are proofreading the machine-generated front and back matter of a printed book.
Each line below is a separate typographic element (headings, labels, dates and short display
fragments are intentional and fine; the publication's tagline may be an intentional fragment).
Judge ONLY full prose sentences. Flag, as a JSON array of strings (empty array if clean): a name or
word repeated redundantly within one sentence; a sentence carrying no information; a grammatical
break mid-sentence; leaked web boilerplate (subscribe buttons, "click to read", share prompts).
JSON array only, no commentary.

${prose}`;
  try {
    const out = execFileSync("claude", ["-p", prompt, "--model", "haiku"],
      { encoding: "utf-8", timeout: 120000 });
    const m = out.match(/\[[\s\S]*\]/);
    const items = m ? JSON.parse(m[0]) : [];
    for (const it of items) findings.push(`llm-judge: ${it}`);
  } catch (e) { warn.push("llm judge unavailable: " + String(e.message).slice(0, 80)); }
}

/* ---------- report ---------- */
for (const w of warn) console.log("WARN", w);
if (findings.length) {
  for (const f of findings) console.log("FAIL", f);
  console.log(`\n${findings.length} finding(s) in ${file}`);
  process.exit(1);
}
console.log(`clean: ${file} (${articles} articles, ${tocRows} toc rows${useLLM ? ", llm judge ran" : ""})`);
