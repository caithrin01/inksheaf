#!/usr/bin/env node
// Render a built book HTML to PDF via Paged.js in headless Chromium (the playwright package).
// Usage: node scripts/render-book.mjs proofs/book.html /abs/path/book.pdf
// Serves the book's directory on a loopback port for the run and shuts the server down
// itself, so no http.server is left behind (stray servers broke the renderer gate before).
// Prints PAGES=<n> on success; exits nonzero on any failure. Portable: Mac and Ubuntu.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, dirname, basename, extname, join } from "node:path";
import { chromium } from "playwright";

const [html, pdf] = process.argv.slice(2);
if (!html || !pdf) { console.error("usage: render-book.mjs <book.html> <out.pdf>"); process.exit(2); }
const dir = dirname(resolve(html)), file = basename(html);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const target = resolve(dir, "." + p);
    if (!target.startsWith(dir)) { res.writeHead(403); return res.end(); }
    const st = await stat(target).catch(() => null);
    if (!st || !st.isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[extname(target).toLowerCase()] || "application/octet-stream", "content-length": st.size });
    res.end(await readFile(target));
  } catch { res.writeHead(500); res.end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const started = Date.now();
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/${encodeURIComponent(file)}?v=${Date.now()}`, { waitUntil: "domcontentloaded" });
  const n = await page.evaluate(() => Promise.race([window.__pagedDone,
    new Promise((_, rej) => setTimeout(() => rej(new Error("paged timeout")), 300000))]));
  await page.waitForTimeout(4000);
  /* Blank-page detector (Caithrin, 2026-09-02: "not accept any pages more than 40% blank
     after the opener and closer"). Measured in the laid-out DOM, not by rasterising: for each
     page, the lowest edge of any text or image inside the page's content box against the box's
     bottom. Exempt: front/back matter, part pages, openers, and closers (article boundaries). */
  const pages = await page.evaluate(() => {
    const out = [];
    for (const pg of document.querySelectorAll(".pagedjs_page")) {
      const box = pg.querySelector(".pagedjs_page_content");
      if (!box) { out.push({ blank: 0, kind: "empty" }); continue; }
      const r = box.getBoundingClientRect();
      let low = r.top;
      for (const el of box.querySelectorAll("*")) {
        if (el.children.length && el.tagName !== "IMG") continue;
        if (el.tagName !== "IMG" && !(el.textContent || "").trim()) continue;
        const b = el.getBoundingClientRect(); if (b.height > 0 && b.bottom > low) low = Math.min(b.bottom, r.bottom);
      }
      const blank = r.height ? (r.bottom - low) / r.height : 0;
      const frag = box.querySelector("section.article, .article");
      const matter = box.querySelector(".fm, .part, .getmore, .appendix, .cover");
      let kind = "body";
      if (!frag && matter) kind = "matter";
      else if (frag) {
        const opener = !frag.hasAttribute("data-split-from"), closer = !frag.hasAttribute("data-split-to");
        kind = opener && closer ? "single" : opener ? "opener" : closer ? "closer" : "body";
      }
      /* the first image on the page: if the previous page came up short, this is what was pushed */
      const first = box.querySelector("img[data-fig]");
      out.push({ blank: Math.round(blank * 1000) / 1000, kind, firstFig: first ? first.getAttribute("data-fig") : null });
    }
    return out;
  });
  const MAX = Number(process.env.BLANK_MAX || 0.40);
  const exempt = k => k === "matter" || k === "closer" || k === "opener" || k === "single" || k === "empty";
  const bad = pages.map((p, i) => ({ page: i + 1, blank: p.blank, kind: p.kind, defer: pages[i + 1]?.firstFig || null }))
    .filter(p => !exempt(p.kind) && p.blank > MAX);
  await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(pdf.replace(/\.pdf$/, "") + ".pages.json", JSON.stringify({ max: MAX, bad, pages }, null, 0));
  const st = await stat(pdf);
  if (st.mtimeMs < started) throw new Error("pdf not fresh");
  console.log(`PAGES=${n} ${basename(pdf)} ${st.size} bytes ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (bad.length) {
    console.error(`BLANK PAGES over ${Math.round(MAX * 100)}%: ${bad.map(b => `${b.page} (${b.kind}, ${Math.round(b.blank * 100)}%)`).join(", ")}`);
    if (process.env.BLANK_PAGES !== "warn") throw new Error(`${bad.length} page(s) over ${Math.round(MAX * 100)}% blank`);
  }
} catch (e) {
  console.error(`RENDER FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  server.close();
}
