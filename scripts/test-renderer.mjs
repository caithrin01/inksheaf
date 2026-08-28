#!/usr/bin/env node
// Renderer regression suite. Builds the torture fixture, renders it, and asserts.
// Exit 0 = green. This is the measurable form of "0 bugs, all edge cases accounted for".
// Usage: node scripts/test-renderer.mjs [--skip-render]
import { execFileSync, execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const t0 = Math.floor(Date.now() / 1000);
let pass = 0, fail = 0;
const ok = (cond, name, extra = "") => {
  if (cond) { pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, extra); }
};

/* ---------- 1. build ---------- */
execFileSync("node", ["scripts/build-book.mjs", "https://fixture.invalid",
  "--fixture", "proofs/torture-fixture.json", "--out", "proofs/torture.html"], { stdio: "pipe" });
const html = readFileSync("proofs/torture.html", "utf-8");
const report = JSON.parse(readFileSync("proofs/torture.report.json", "utf-8"));

/* ---------- 2. filter + report assertions ---------- */
ok((html.match(/class="article" id="art-/g) || []).length === 5, "5 printable articles");
for (const bad of ["podcast filter is broken", "crosspost filter is broken",
                   "paywall filter is broken", "slug dedupe is broken", "is_published filter is broken"])
  ok(!html.includes(bad), `excluded: ${bad.split(" ")[0]}`);
ok(report.skips.some(s => s.reason === "duplicate slug"), "duplicate slug reported");
ok(report.skips.some(s => s.reason === "empty body"), "empty body reported");
ok(report.skips.some(s => String(s.reason).includes("title over 120")), "overlong title reported");
ok(report.rtlChars > 0 && report.cjkChars > 0, "rtl+cjk detected", JSON.stringify([report.rtlChars, report.cjkChars]));
ok(report.declineSignals.length === 0, "no unexpected decline signals", JSON.stringify(report.declineSignals));
ok(report.omittedPaid === 1, "paid omission counted");
ok(report.deadImages.length === 3, "3 dead images detected", String(report.deadImages.length));

/* ---------- 3. content-shape assertions ---------- */
ok((html.match(/class="tocrow"/g) || []).length === 5, "toc rows match articles");
ok(html.includes('class="tocby"'), "toc bylines (multi-author)");
ok(html.includes("Essays by Fixture Author A, with contributions from 1 other"), "title-page roster with principals threshold");
ok(html.includes('class="verse'), "verse class applied");
ok(html.includes('class="gifnote"'), "gif caption present");
ok(html.includes('class="longurl"'), "longurl span present");
ok(html.includes('class="opener"'), "opener drop-cap class present");
ok(html.includes('class="embedcard"'), "iframe became embedcard");
ok(!/<iframe/.test(html), "no raw iframes remain");
ok(!/<script/i.test(html.split("</style>")[1].split("<script>")[0] || ""), "no scripts inside body content");
ok(html.includes("figcaption"), "figcaption preserved");
ok(!html.includes('[{"type":'), "no raw ProseMirror JSON leaks");
ok(!html.includes("A Video Interview That Must Not Print As A Chapter"), "media-only post excluded from chapters");
ok(html.includes("piece is a video or audio conversation"), "media-only About note printed");
ok(!/(?<!\d)0 words/.test(html), "no zero-word meta lines");
ok(html.includes("Text after the comment blob that must survive."), "text after comment blob survives");
ok(html.includes("1 paid") || html.includes("1 paid essay"), "paid-omission note printed");

/* ---------- 4. render + in-DOM assertions ---------- */
if (!process.argv.includes("--skip-render")) {
  const port = 9200 + Math.floor(Math.random() * 300);
  const srv = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
    { cwd: "proofs", stdio: "ignore" });
  await new Promise(r => setTimeout(r, 1000));
  let domOut = "";
  try {
    execSync("playwright-cli open about:blank", { stdio: "pipe" });
    domOut = execSync(`playwright-cli run-code "async page => {
      await page.goto('http://127.0.0.1:${port}/torture.html?v=' + Date.now(), {waitUntil:'domcontentloaded'});
      const n = await page.evaluate(() => Promise.race([window.__pagedDone, new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), 180000))]));
      await page.waitForTimeout(2500);
      const r = await page.evaluate(() => {
        const pages = [...document.querySelectorAll('.pagedjs_page')];
        // text-integrity scan: any glyph past the page edge means clipped (LOST) print content
        const overflow = pages.filter(pg => {
          const c = pg.querySelector('.pagedjs_page_content');
          if (!c) return false;
          const R = c.getBoundingClientRect();
          const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const t = walker.currentNode;
            if (!t.textContent.trim()) continue;
            const range = document.createRange(); range.selectNodeContents(t);
            for (const r2 of range.getClientRects())
              if (r2.width > 0 && r2.right > R.right + 2) return true;
          }
          return false;
        }).length;
        const verse = document.querySelector('p.verse');
        const verseLeft = verse ? getComputedStyle(verse).textAlign === 'left' : false;
        const missing = document.querySelectorAll('.imgmissing').length;
        // margin-box text lives on the margin-content ::after pseudo
        const headerHasTitle = pages.some(pg => {
          const mc = pg.querySelector('.pagedjs_margin-top-right .pagedjs_margin-content');
          return mc && getComputedStyle(mc, '::after').content.includes('Torture Chapter');
        });
        const folio = pages.some(pg => {
          const mc = pg.querySelector('.pagedjs_margin-bottom-center .pagedjs_margin-content');
          return mc && getComputedStyle(mc, '::after').content.includes('counter(page)');
        });
        const fnLink = document.querySelector('a[href^=\\"#fn-torture-1\\"]');
        const fnTarget = fnLink ? !!document.getElementById(fnLink.getAttribute('href').slice(1)) : false;
        return { pages: pages.length, overflow, verseLeft, missing, headerHasTitle, folio, fnTarget };
      });
      await page.pdf({ path: '/Users/caithrinrintoul/repos/inksheaf/proofs/torture-proof.pdf', preferCSSPageSize: true, printBackground: true });
      return 'DOM=' + JSON.stringify(r) + ' N=' + n;
    }"`, { encoding: "utf-8", timeout: 300000 });
  } finally {
    try { execSync("playwright-cli close", { stdio: "pipe" }); } catch {}
    srv.kill();
  }
  const m = domOut.replace(/\\"/g, '"').match(/DOM=({.*?}) N=/);
  ok(!!m, "render completed", domOut.slice(-200));
  if (m) {
    const d = JSON.parse(m[1]);
    ok(d.pages >= 9, "page count sane", String(d.pages));
    ok(d.overflow === 0, "no text-loss pages (glyphs past page edge)", String(d.overflow));
    ok(d.verseLeft, "verse computes ragged-left");
    ok(d.missing === 3, "3 missing-image boxes rendered", String(d.missing));
    ok(d.headerHasTitle, "running header carries article title");
    ok(d.folio, "folio page numbers render");
    ok(d.fnTarget, "footnote link resolves to namespaced target");
  }
  const mt = Number(execSync("stat -f %m proofs/torture-proof.pdf", { encoding: "utf-8" }).trim());
  ok(mt >= t0, "torture PDF is fresh, not stale");
}

/* ---------- 4b. content-kind fixtures ---------- */
execFileSync("node", ["scripts/build-book.mjs", "https://fixture.invalid",
  "--fixture", "proofs/letters-fixture.json", "--out", "proofs/letters-test.html"], { stdio: "pipe" });
const lettersHtml = readFileSync("proofs/letters-test.html", "utf-8");
const lettersReport = JSON.parse(readFileSync("proofs/letters-test.report.json", "utf-8"));
ok(lettersReport.kind === "letters", "letters kind detected", lettersReport.kind);
ok((lettersHtml.match(/class="tocpart"/g) || []).length === 2, "letters TOC groups into 2 month parts");
ok(lettersHtml.includes('class="tocex"'), "letters TOC rows carry excerpts");
ok((lettersHtml.match(/class="part" /g) || []).length === 2, "2 part divider pages");
ok(!/class="artnum"/.test(lettersHtml), "no chapter numerals on letters");
ok(lettersHtml.includes("6 letters"), "cover foot says letters");
try { execFileSync("node", ["scripts/proof-lint.mjs", "proofs/letters-test.html"], { stdio: "pipe" }); ok(true, "letters book lint-clean"); }
catch { ok(false, "letters book lint-clean"); }

execFileSync("node", ["scripts/build-book.mjs", "https://fixture.invalid",
  "--fixture", "proofs/recipes-fixture.json", "--out", "proofs/recipes-test.html"], { stdio: "pipe" });
const recipesReport = JSON.parse(readFileSync("proofs/recipes-test.report.json", "utf-8"));
ok(recipesReport.kind === "recipes", "recipes kind detected from tags", recipesReport.kind);
ok(readFileSync("proofs/recipes-test.html", "utf-8").includes("3 recipes"), "cover foot says recipes");

/* ---------- 5. lint ---------- */
try { execFileSync("node", ["scripts/proof-lint.mjs", "proofs/torture.html"], { stdio: "pipe" }); ok(true, "proof-lint clean"); }
catch { ok(false, "proof-lint clean"); }

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
