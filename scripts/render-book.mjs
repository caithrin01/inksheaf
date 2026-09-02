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
  await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
  const st = await stat(pdf);
  if (st.mtimeMs < started) throw new Error("pdf not fresh");
  console.log(`PAGES=${n} ${basename(pdf)} ${st.size} bytes ${((Date.now() - started) / 1000).toFixed(1)}s`);
} catch (e) {
  console.error(`RENDER FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  server.close();
}
