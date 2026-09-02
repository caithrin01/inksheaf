#!/usr/bin/env node
// Full-wrap print cover at Lulu's measured geometry. Usage:
//   node scripts/cover-wrap.mjs <width_pt> <height_pt> <out.html> [plate.png]
//     [--meta meta.json] [--brand brand.json]
// Geometry from /cover-dimensions/ (includes bleed). Panels: back | spine | front.
// --meta supplies publication copy (title, noun, dates, counts, blurb, host); without it the
// original caithrin edition values apply, so the shipped artifact stays reproducible.
// Design (Caithrin, 2026-08-31): the classic ivory literary paperback for every publication,
// whatever its web palette: ivory ground, a black rule inside a red rule, the masthead set in
// Garamond, red rubric, muted ink for dates and foot. --brand is still accepted so older
// callers keep working, but its colours stay on the web; the plate border is the only use.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import QRCode from "qrcode";

const pos = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--meta" && all[i - 1] !== "--brand");
const [W, H, OUT] = [+pos[0], +pos[1], pos[2]];
if (!W || !H || !OUT) { console.error("usage: cover-wrap.mjs <w_pt> <h_pt> <out.html> [plate] [--meta m.json] [--brand b.json]"); process.exit(2); }
const argOf = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const BLEED = 9, TRIM_W = 432;
const SPINE = W - 2 * BLEED - 2 * TRIM_W;

const brandPath = argOf("--brand");
if (brandPath && !existsSync(brandPath)) console.error(`cover-wrap: brand file ${brandPath} not found; the ivory design does not need it`);
const META = argOf("--meta") ? JSON.parse(readFileSync(argOf("--meta"), "utf-8")) : {
  pubName: "caithrin", host: "www.caithrin.com",
  kindLine: "Collected Essays · 2025–2026",
  spineText: "caithrin · Collected Essays · 2025–2026",
  dates: "January 2025 – August 2026",
  countLine: "40 essays",
  blurb: "though much is token, much abides.",
  desc: "Forty essays on machines that write, the people who read them, and the year the two stopped being separable. Collected from caithrin.com: January 2025 to August 2026, printed in the order they first appeared.",
};
/* the ivory palette, shared with the site's preview cover (src/pages/index.astro .cover) */
const IVORY = "#f9f4e6", INK = "#1e1710", RED = "#a93b22", MUTED = "rgba(30,23,16,.62)";
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const qr = await QRCode.toDataURL(`https://${META.host}`, { margin: 0, width: 300, color: { dark: INK, light: "#0000" } });
const plate = pos[3] || null;
// spine text is physically unreadable on a very thin book; suppress rather than clip (R2)
const spine = SPINE >= 18 ? `<span>${esc(META.spineText)}</span>` : "";
const host = META.host.replace(/^www\./, "");
/* frames sit inside the trim: 16pt black, then 22pt red, measured from the trim edges.
   the panel boxes include the outer bleed, so the outer-side insets add BLEED. */
const FRAME_OUT = 16, FRAME_IN = 22;
const frame = (side, inset) => side === "front"
  ? `top:${BLEED + inset}pt; bottom:${BLEED + inset}pt; left:${inset}pt; right:${BLEED + inset}pt`
  : `top:${BLEED + inset}pt; bottom:${BLEED + inset}pt; left:${BLEED + inset}pt; right:${inset}pt`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@500;600&display=swap" rel="stylesheet">
<style>
@page { size: ${W}pt ${H}pt; margin: 0; }
html,body{ margin:0; width:${W}pt; height:${H}pt; background:${IVORY}; color:${INK};
  font-family:"EB Garamond", Garamond, Georgia, serif; -webkit-print-color-adjust:exact }
.panel{ position:absolute; top:0; height:${H}pt; box-sizing:border-box }
.front{ left:${BLEED + TRIM_W + SPINE}pt; width:${TRIM_W}pt; padding:${BLEED + 78}pt ${BLEED + 54}pt ${BLEED + 62}pt 54pt;
  display:flex; flex-direction:column; align-items:center; text-align:center }
.back{ left:${BLEED}pt; width:${TRIM_W}pt; padding:${BLEED + 78}pt 54pt ${BLEED + 62}pt ${BLEED + 54}pt }
.spine{ left:${BLEED + TRIM_W}pt; width:${SPINE}pt; display:flex; align-items:center; justify-content:center }
.spine span{ transform:rotate(90deg); white-space:nowrap; font-family:Inter, sans-serif; font-weight:500;
  font-size:${SPINE >= 30 ? 10 : 8}pt; letter-spacing:.24em; text-transform:uppercase; color:${MUTED} }
.frame{ position:absolute; pointer-events:none }
.frame.ink{ border:1.5pt solid ${INK}; opacity:.85 }
.frame.red{ border:1pt solid ${RED}; opacity:.9 }
.kind{ font-family:Inter, sans-serif; font-size:8.5pt; letter-spacing:.32em; padding-left:.32em; text-transform:uppercase; color:${RED}; font-weight:600; margin-top:.35in }
h1{ font-weight:500; font-size:38pt; line-height:1.12; margin:.12in 0 0; color:${INK}; letter-spacing:.005em; overflow-wrap:anywhere; max-width:100% }
.orn{ color:${RED}; font-size:15pt; margin:.34in 0 }
.dates{ font-size:12.5pt; color:${MUTED} }
.mid{ flex:1 }
.plate{ margin-top:.45in }
.plate img{ width:2.5in; height:2.5in; object-fit:cover; border:1pt solid ${MUTED}; padding:.08in }
.footwrap{ width:100%; display:grid; gap:.09in; justify-items:center; padding-top:.2in }
.pages{ font-size:10pt; color:${MUTED}; letter-spacing:.06em; white-space:nowrap }
.foot{ font-family:Inter, sans-serif; font-size:7.5pt; letter-spacing:.24em; text-transform:uppercase; color:${MUTED}; display:flex; gap:.5in }
.back .blurb{ font-size:13pt; line-height:1.55; color:${INK}; font-style:italic; margin-bottom:.3in }
.back .desc{ font-size:11pt; line-height:1.6; color:${INK}; opacity:.82 }
.back .qr{ position:absolute; bottom:${BLEED + 62 + 34}pt; left:${BLEED + 54}pt }
.back .qr img{ width:.85in; height:.85in }
.back .imprint{ position:absolute; bottom:${BLEED + 62}pt; left:${BLEED + 54}pt; right:54pt; font-family:Inter,sans-serif;
  font-size:7pt; letter-spacing:.12em; text-transform:uppercase; color:${MUTED}; border-top:1pt solid ${RED}; padding-top:.12in }
</style></head><body>
<div class="panel back">
  <div class="frame ink" style="${frame("back", FRAME_OUT)}"></div>
  <div class="frame red" style="${frame("back", FRAME_IN)}"></div>
  ${META.blurb ? `<div class="blurb">${esc(META.blurb)}</div>` : ""}
  <div class="desc">${esc(META.desc)}</div>
  <div class="qr"><img src="${qr}"></div>
  <div class="imprint">${esc(host)} · Printed by Inksheaf · inksheaf.com</div>
</div>
<div class="panel spine">${spine}</div>
<div class="panel front">
  <div class="frame ink" style="${frame("front", FRAME_OUT)}"></div>
  <div class="frame red" style="${frame("front", FRAME_IN)}"></div>
  <h1>${esc(META.pubName)}</h1>
  <div class="kind">${esc(META.kindLine)}</div>
  <div class="orn">&#10087;</div>
  <div class="dates">${esc(META.dates)}</div>
  ${plate ? `<div class="plate"><img src="${plate}"></div>` : ""}
  <div class="mid"></div>
  <div class="footwrap"><span class="pages">${esc(META.countLine)} · 6 × 9 · perfect bound</span><span class="foot"><span>${esc(host)}</span><span>Inksheaf</span></span></div>
</div>
</body></html>`;
writeFileSync(OUT, html);
console.log(JSON.stringify({ W, H, SPINE, out: OUT, spineTextShown: !!spine, design: "ivory" }));
