#!/usr/bin/env node
// Full-wrap print cover at Lulu's measured geometry. Usage:
//   node scripts/cover-wrap.mjs <width_pt> <height_pt> <out.html> [plate.png]
//     [--meta meta.json] [--brand brand.json]
// Geometry from /cover-dimensions/ (includes bleed). Panels: back | spine | front.
// --meta supplies publication copy (title, noun, dates, counts, blurb, host); without it the
// original caithrin edition values apply, so the shipped artifact stays reproducible.
import { writeFileSync, readFileSync } from "node:fs";
import QRCode from "qrcode";

const pos = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--meta" && all[i - 1] !== "--brand");
const [W, H, OUT] = [+pos[0], +pos[1], pos[2]];
if (!W || !H || !OUT) { console.error("usage: cover-wrap.mjs <w_pt> <h_pt> <out.html> [plate] [--meta m.json] [--brand b.json]"); process.exit(2); }
const argOf = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const BLEED = 9, TRIM_W = 432;
const SPINE = W - 2 * BLEED - 2 * TRIM_W;

const brand = JSON.parse(readFileSync(argOf("--brand") || "proofs/caithrin.brand.json", "utf-8"));
const META = argOf("--meta") ? JSON.parse(readFileSync(argOf("--meta"), "utf-8")) : {
  pubName: "caithrin", host: "www.caithrin.com",
  kindLine: "Collected Essays · 2025–2026",
  spineText: "caithrin · Collected Essays · 2025–2026",
  dates: "January 2025 – August 2026",
  countLine: "40 essays",
  blurb: "though much is token, much abides.",
  desc: "Forty essays on machines that write, the people who read them, and the year the two stopped being separable. Collected from caithrin.com: January 2025 to August 2026, printed in the order they first appeared.",
};
const bg = brand.cover_bg, ink = brand.cover_print, ink2 = brand.cover_print_secondary;
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const qr = await QRCode.toDataURL(`https://${META.host}`, { margin: 0, width: 300, color: { dark: "#e9e2d3", light: "#0000" } });
const plate = pos[3] || null;
// spine text is physically unreadable on a very thin book; suppress rather than clip (R2)
const spine = SPINE >= 18 ? `<span>${esc(META.spineText)}</span>` : "";

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700&family=Source+Serif+4:opsz,wght@8..60,300..700&display=swap" rel="stylesheet">
<style>
@page { size: ${W}pt ${H}pt; margin: 0; }
html,body{ margin:0; width:${W}pt; height:${H}pt; background:${bg}; color:${ink};
  font-family:"Source Serif 4", Georgia, serif; -webkit-print-color-adjust:exact }
.panel{ position:absolute; top:0; height:${H}pt }
.front{ left:${BLEED + TRIM_W + SPINE}pt; width:${TRIM_W}pt; padding:${BLEED + 60}pt 40pt ${BLEED + 50}pt; box-sizing:border-box }
.back{ left:${BLEED}pt; width:${TRIM_W}pt; padding:${BLEED + 60}pt 40pt ${BLEED + 50}pt; box-sizing:border-box }
.spine{ left:${BLEED + TRIM_W}pt; width:${SPINE}pt; display:flex; align-items:center; justify-content:center }
.spine span{ transform:rotate(90deg); white-space:nowrap; font-family:Inter, sans-serif; font-weight:600;
  font-size:13pt; letter-spacing:.18em; color:${ink} }
.kind{ font-family:Inter, sans-serif; font-size:10pt; letter-spacing:.3em; text-transform:uppercase; color:${ink}; font-weight:600 }
h1{ font-family:Inter, sans-serif; font-weight:700; font-size:40pt; margin:.35in 0 0; color:${ink}; letter-spacing:-.01em }
.rule{ width:.55in; border-bottom:3pt solid ${ink}; margin:.28in 0 }
.dates{ font-size:12pt; color:${ink2} }
.plate{ margin-top:.5in }
.plate img{ width:2.7in; height:2.7in; object-fit:cover; border:1pt solid ${ink2}; padding:.08in }
.foot{ position:absolute; bottom:${BLEED + 50}pt; left:40pt; right:40pt; border-top:1pt solid ${ink2};
  padding-top:.16in; display:flex; justify-content:space-between; font-size:9pt; color:${ink2} }
.back .blurb{ font-size:11.5pt; line-height:1.6; color:${ink}; font-style:italic; margin-bottom:.35in }
.back .desc{ font-size:10.5pt; line-height:1.65; color:${ink2} }
.back .qr{ position:absolute; bottom:${BLEED + 95}pt; left:40pt }
.back .qr img{ width:.95in; height:.95in }
.back .imprint{ position:absolute; bottom:${BLEED + 50}pt; left:40pt; right:40pt; font-family:Inter,sans-serif;
  font-size:7.5pt; letter-spacing:.08em; color:${ink2}; border-top:1pt solid ${ink2}; padding-top:.14in }
</style></head><body>
<div class="panel back">
  ${META.blurb ? `<div class="blurb">${esc(META.blurb)}</div>` : ""}
  <div class="desc">${esc(META.desc)}</div>
  <div class="qr"><img src="${qr}"></div>
  <div class="imprint">${esc(META.host.replace(/^www\./, ""))} · Printed by Inksheaf · inksheaf.com</div>
</div>
<div class="panel spine">${spine}</div>
<div class="panel front">
  <div class="kind">${esc(META.kindLine)}</div>
  <h1>${esc(META.pubName)}</h1>
  <div class="rule"></div>
  <div class="dates">${esc(META.dates)}</div>
  ${plate ? `<div class="plate"><img src="${plate}"></div>` : ""}
  <div class="foot"><span>${esc(META.countLine)}</span><span>${esc(META.host.replace(/^www\./, ""))}</span></div>
</div>
</body></html>`;
writeFileSync(OUT, html);
console.log(JSON.stringify({ W, H, SPINE, out: OUT, spineTextShown: !!spine }));
