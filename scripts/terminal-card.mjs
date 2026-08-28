#!/usr/bin/env node
// Teaser asset A9: the trust beat. Renders the REAL suite output captured to
// assets/shots/suite-output.txt into a terminal card. Refuses to run without it.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const lines = readFileSync("assets/shots/suite-output.txt", "utf-8").trimEnd().split("\n");
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const body = lines.map(l =>
  l.startsWith("PASS") ? `<div><span class="p">PASS</span>${esc(l.slice(4))}</div>`
  : /pass, 0 fail/.test(l) ? `<div class="sum">${esc(l)}</div>` : `<div>${esc(l) || "&nbsp;"}</div>`).join("\n");

const html = `<!doctype html><html><head><meta charset="utf-8">
<style>
body{margin:0;width:1920px;height:1080px;display:flex;align-items:center;justify-content:center;background:#efe8d8}
.term{width:1180px;background:#171410;border-radius:10px;box-shadow:24px 34px 60px -24px rgba(34,29,22,.5);overflow:hidden}
.bar{background:#221d16;padding:16px 20px;display:flex;gap:10px}
.dot{width:16px;height:16px;border-radius:50%;background:#4a443a}
.body{padding:36px 44px 44px;font:24px/1.7 "SF Mono",Menlo,monospace;color:#e9e2d3}
.cmd{color:#8a8272}
.p{color:#7bc47f;font-weight:600;margin-right:1ch}
.sum{color:#7bc47f;font-weight:600;margin-top:.5em}
</style></head><body><div class="term">
<div class="bar"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
<div class="body"><div class="cmd">$ node scripts/test-renderer.mjs</div>${body}</div>
</div></body></html>`;
writeFileSync("assets/shots/terminal-card.html", html);

const { spawn } = await import("node:child_process");
const port = 9100 + Math.floor(Math.random() * 400);
const srv = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: "assets/shots", stdio: "ignore" });
await new Promise(r => setTimeout(r, 1000));
const code = `async page => {
  await page.setViewportSize({width: 3840, height: 2160});
  await page.goto('http://127.0.0.1:${port}/terminal-card.html', {waitUntil:'networkidle'});
  try { await page.addStyleTag({content: 'html{zoom:2}'}); } catch {}
  await page.waitForTimeout(600);
  await page.screenshot({path: '${process.cwd()}/assets/shots/terminal-card.png'});
  return 'ok';
}`;
try { execFileSync("playwright-cli", ["open", "about:blank"], { stdio: "pipe" }); } catch {}
try {
  const out = execFileSync("playwright-cli", ["run-code", code], { stdio: ["ignore","pipe","pipe"] }).toString();
  console.log(out.includes('"ok"') ? "terminal-card.png written" : "FAILED: " + out.slice(0, 200));
} finally { srv.kill(); }
