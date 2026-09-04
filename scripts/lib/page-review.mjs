// Page review: a model reads every page of a proof before the writer does (plan-page-review-v1,
// asked by Caithrin 2026-08-28, 2026-09-02 twice, 2026-09-03; built 2026-09-04).
//
// Pass 1: every page, four to a contact sheet, a cheap document-vision model answers a fixed
// checklist with page numbers. Pass 2: each flagged page alone, at higher resolution, a stronger
// model confirms or dismisses. Only confirmed findings are reported. The review annotates; it
// never throws on a model failure, so a proof is never held up by the reviewer being down.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

export const CHECKS = {
  1: "Blank space: more than a third of the text block empty on a page that is not an essay's last page.",
  2: "Orphans and widows: a heading alone at the foot; a single line of a paragraph alone at the top or foot.",
  3: "Figures: an image separated from its caption; an image cropped or overflowing the text block; an image too small to read; a placeholder box, 'could not be retrieved' or broken-image notice where a picture should be.",
  4: "Overflow: a table, code block, URL or wide word running past the right margin or off the page.",
  5: "Running heads and folios: the head names the wrong essay; a folio missing; front matter carrying a head.",
  6: "Glyphs: boxes, question marks in diamonds, mojibake, a font fallback (a line in a different face).",
  7: "Artefacts: raw HTML or markup printed, a stray 'Figure 1:' label, doubled rules, a stray 'Leave a comment' or 'Subscribe' button text, an empty page in the body.",
  8: "Reading order: two columns where there should be one, a paragraph split by a figure mid-sentence.",
};
export const PASS1_MODEL = process.env.REVIEW_PASS1_MODEL || "google/gemini-3.1-flash-lite";
export const PASS2_MODEL = process.env.REVIEW_PASS2_MODEL || "anthropic/claude-sonnet-5";

const checklist = () => Object.entries(CHECKS).map(([n, t]) => `${n}. ${t}`).join("\n");

/* pdftoppm: every page as PNG, longest side `scale` px. Returns the page files in order. */
export function rasterise(pdf, dir, { scale = 900, first, last } = {}) {
  mkdirSync(dir, { recursive: true });
  const args = ["-png", "-scale-to", String(scale)];
  if (first) args.push("-f", String(first));
  if (last) args.push("-l", String(last));
  execFileSync("pdftoppm", [...args, pdf, join(dir, "p")], { stdio: ["ignore", "ignore", "pipe"] });
  return readdirSync(dir).filter(f => /^p-\d+\.png$/.test(f)).sort((a, b) => num(a) - num(b)).map(f => join(dir, f));
}
const num = f => Number(f.match(/(\d+)\.png$/)[1]);
export const pageOf = f => num(basename(f));

/* 2 x 2 contact sheets, each tile labelled with its page number in the corner (Pillow, present in
   the press workflow and the unit-gate image). Returns [{file, pages:[n,...]}]. */
export function contactSheets(pages, dir) {
  mkdirSync(dir, { recursive: true });
  const groups = [];
  for (let i = 0; i < pages.length; i += 4) groups.push(pages.slice(i, i + 4));
  const spec = groups.map((g, i) => ({ out: join(dir, `sheet-${String(i + 1).padStart(3, "0")}.jpg`), tiles: g.map(f => ({ file: f, page: pageOf(f) })) }));
  const py = `
import json,sys
from PIL import Image, ImageDraw
spec=json.load(sys.stdin)
for s in spec:
    tiles=[Image.open(t["file"]).convert("RGB") for t in s["tiles"]]
    w=max(im.width for im in tiles); h=max(im.height for im in tiles)
    sheet=Image.new("RGB",(w*2+30,h*2+30),(120,120,120))
    d=ImageDraw.Draw(sheet)
    for i,(im,t) in enumerate(zip(tiles,s["tiles"])):
        x=(i%2)*(w+10)+10; y=(i//2)*(h+10)+10
        sheet.paste(im,(x,y))
        label="page %d"%t["page"]
        d.rectangle([x,y,x+90,y+22],fill=(200,30,30)); d.text((x+6,y+5),label,fill=(255,255,255))
    sheet.save(s["out"],"JPEG",quality=82)
print(len(spec))
`;
  execFileSync("python3", ["-c", py], { input: JSON.stringify(spec), stdio: ["pipe", "ignore", "pipe"] });
  return spec.map(s => ({ file: s.out, pages: s.tiles.map(t => t.page) }));
}

/* the model call: OpenRouter chat completions with image parts; returns text or throws */
export async function askOpenRouter({ model, images, text, maxTokens = 800, key = process.env.OPENROUTER_API_KEY }) {
  if (!key) throw new Error("no OPENROUTER_API_KEY");
  const content = [...images.map(f => ({ type: "image_url", image_url: { url: `data:image/${f.endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(f).toString("base64")}` } })), { type: "text", text }];
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "HTTP-Referer": "https://inksheaf.com", "X-Title": "Inksheaf page review" },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, messages: [{ role: "user", content }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${model}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
  return { text: j.choices?.[0]?.message?.content || "", usage: j.usage || null };
}

/* pull a JSON array or object out of a model answer that may carry prose or fences */
export function parseJson(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("["), o = t.indexOf("{");
  const start = (a >= 0 && (o < 0 || a < o)) ? a : o;
  if (start < 0) return null;
  const end = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"));
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

const pass1Prompt = pages => `You are checking typeset book pages for production defects. This contact sheet holds ${pages.length} pages of a 6 by 9 inch book, in reading order: top-left is page ${pages[0]}, top-right page ${pages[1] ?? "-"}, bottom-left page ${pages[2] ?? "-"}, bottom-right page ${pages[3] ?? "-"}. Each tile carries its page number in a red label.

Look for only these defects:
${checklist()}

Chapter openers, section closers, title pages, contents pages, part-title pages, dedication and epigraph pages, and the short notes and links pages at the back are allowed to be mostly empty; do not report check 1 for them. A completely blank page is normal when it is the back of a half-title, title, dedication or epigraph page, the page before a part or chapter opener, or the last page of the book; report a blank page (check 7) only when it sits between pages of running body text. Body text set in a book face with a running head and a folio is normal; report only what is wrong.

Answer with a JSON array and nothing else. Each element: {"page": <number>, "check": <1-8>, "note": "<one sentence>", "confidence": <0 to 1>}. An empty array [] when nothing is wrong.`;

const pass2Prompt = f => `This is page ${f.page} of a typeset 6 by 9 inch book, shown alone at full size. A first reader flagged it under check ${f.check}: "${CHECKS[f.check] || ""}" with the note: "${f.note}".

Look at the page carefully and decide whether that defect is really present. Chapter openers, closers, title and contents pages may legitimately be mostly empty, and a blank page is normal as the back of front matter, before an opener, or at the very end. Describe what is actually on this page in your note. A placeholder box or "could not be retrieved" text where an image should be is a real defect.

If this page is the last page of an essay, a chapter or part opener, a dedication, epigraph, contents or title page, or a notes, links or "get more" page at the back, empty space on it is normal: answer confirmed false.

Answer with one JSON object and nothing else, the note under 25 words: {"confirmed": true or false, "note": "<what you see>"}.`;

/* the review. `ask` is injectable for tests. Never throws on model trouble: errors are recorded. */
export async function reviewPdf(pdf, { outDir, ask = askOpenRouter, pass1Model = PASS1_MODEL, pass2Model = PASS2_MODEL, minConfidence = 0.35, key = process.env.OPENROUTER_API_KEY, log = () => {} } = {}) {
  const started = Date.now();
  const out = { pdf, pages: 0, sheets: 0, pass1: { model: pass1Model, calls: 0, flagged: 0, errors: 0 }, pass2: { model: pass2Model, calls: 0, confirmed: 0, dismissed: 0, errors: 0 }, findings: [], dismissed: [], errors: [], usage: { prompt_tokens: 0, completion_tokens: 0 }, skipped: null, ms: 0 };
  if (!key && ask === askOpenRouter) { out.skipped = "no OPENROUTER_API_KEY"; return out; }
  const dir = outDir || join(process.env.TMPDIR || "/tmp", `page-review-${basename(pdf).replace(/\.pdf$/, "")}-${Date.now()}`);
  let pages;
  try { pages = rasterise(pdf, join(dir, "pages")); } catch (e) { out.errors.push(`rasterise: ${String(e.message).slice(0, 120)}`); out.ms = Date.now() - started; return out; }
  out.pages = pages.length;
  let sheets;
  try { sheets = contactSheets(pages, join(dir, "sheets")); } catch (e) { out.errors.push(`contact sheets: ${String(e.message).slice(0, 120)}`); out.ms = Date.now() - started; return out; }
  out.sheets = sheets.length;
  const flagged = [];
  for (const s of sheets) {
    try {
      const r = await ask({ model: pass1Model, images: [s.file], text: pass1Prompt(s.pages), maxTokens: 800 });
      out.pass1.calls++; addUsage(out, r.usage);
      const arr = parseJson(r.text);
      if (!Array.isArray(arr)) { out.pass1.errors++; out.errors.push(`pass1 sheet ${s.pages[0]}: unparseable answer`); continue; }
      for (const f of arr) {
        const page = Number(f.page), check = Number(f.check), conf = Number(f.confidence);
        if (!s.pages.includes(page) || !CHECKS[check] || !(conf >= minConfidence)) continue;
        flagged.push({ page, check, note: String(f.note || "").slice(0, 200), confidence: Math.round(conf * 100) / 100 });
      }
    } catch (e) { out.pass1.errors++; out.errors.push(`pass1 sheet ${s.pages[0]}: ${String(e.message).slice(0, 120)}`); }
    log(`pass1 sheet ${s.pages[0]}-${s.pages[s.pages.length - 1]}: ${flagged.length} flagged so far`);
  }
  /* one pass-2 call per flagged page, the strongest flag first when a page carries several */
  const byPage = new Map();
  for (const f of flagged.sort((a, b) => b.confidence - a.confidence)) if (!byPage.has(f.page)) byPage.set(f.page, f);
  out.pass1.flagged = byPage.size;
  for (const f of byPage.values()) {
    let single;
    /* one directory per page: pdftoppm names by page number and a shared directory once handed
       pass 2 the first page rasterised for every flag (found on the first real run, 2026-09-04) */
    try { single = rasterise(pdf, join(dir, "single", String(f.page)), { scale: 1800, first: f.page, last: f.page }).find(x => pageOf(x) === f.page); if (!single) throw new Error("no raster"); } catch (e) { out.errors.push(`page ${f.page}: raster ${String(e.message).slice(0, 80)}`); continue; }
    try {
      const r = await ask({ model: pass2Model, images: [single], text: pass2Prompt(f), maxTokens: 400 });
      out.pass2.calls++; addUsage(out, r.usage);
      let j = parseJson(r.text);
      /* a truncated or chatty answer still usually carries the verdict */
      if (!j || typeof j.confirmed !== "boolean") { const m = String(r.text || "").match(/"confirmed"\s*:\s*(true|false)/i); if (m) j = { confirmed: m[1].toLowerCase() === "true", note: (String(r.text).match(/"note"\s*:\s*"([^"]{0,200})/) || [])[1] || f.note }; }
      if (!j || typeof j.confirmed !== "boolean") { out.pass2.errors++; out.errors.push(`pass2 page ${f.page}: unparseable answer: ${String(r.text || "").replace(/\s+/g, " ").slice(0, 90)}`); continue; }
      const rec = { page: f.page, check: f.check, note: String(j.note || f.note).slice(0, 200), pass1: f.note, confidence: f.confidence };
      if (j.confirmed) { out.findings.push(rec); out.pass2.confirmed++; } else { out.dismissed.push(rec); out.pass2.dismissed++; }
    } catch (e) { out.pass2.errors++; out.errors.push(`pass2 page ${f.page}: ${String(e.message).slice(0, 120)}`); }
  }
  out.findings.sort((a, b) => a.page - b.page);
  out.ms = Date.now() - started;
  try { writeFileSync(join(dir, "review.json"), JSON.stringify(out, null, 1)); out.dir = dir; } catch {}
  return out;
}
function addUsage(out, u) { if (!u) return; out.usage.prompt_tokens += Number(u.prompt_tokens) || 0; out.usage.completion_tokens += Number(u.completion_tokens) || 0; }

/* one line for a writer, one block for the operator */
export function writerLine(r) {
  if (!r || r.skipped) return "";
  if (r.errors.length && !r.pass1.calls) return "";
  const n = r.findings.length;
  if (!n) return `A reader model went through all ${r.pages} pages before this was sent and flagged nothing; your own read is still the one that counts.`;
  const list = r.findings.slice(0, 6).map(f => `p. ${f.page} (${shortCheck(f.check)})`).join(", ");
  return `A reader model went through all ${r.pages} pages before this was sent and flagged ${n} page${n === 1 ? "" : "s"} worth a look: ${list}${n > 6 ? ", and more in the full list we keep" : ""}. If you agree, ask for a change below and we fix it before it prints.`;
}
export function operatorBlock(r) {
  if (!r) return "page review: not run";
  if (r.skipped) return `page review: skipped (${r.skipped})`;
  const head = `page review: ${r.pages} pages, ${r.sheets} sheets, pass1 ${r.pass1.model} flagged ${r.pass1.flagged}, pass2 ${r.pass2.model} confirmed ${r.pass2.confirmed} dismissed ${r.pass2.dismissed}, errors ${r.errors.length}, ${Math.round(r.ms / 1000)}s, tokens ${r.usage.prompt_tokens}/${r.usage.completion_tokens}`;
  const lines = r.findings.map(f => `  p.${f.page} check ${f.check} ${shortCheck(f.check)}: ${f.note}`);
  const errs = r.errors.slice(0, 5).map(e => `  ! ${e}`);
  return [head, ...lines, ...errs].join("\n");
}
const shortCheck = n => ({ 1: "blank space", 2: "orphan/widow", 3: "figure", 4: "overflow", 5: "running head/folio", 6: "glyphs", 7: "artefact", 8: "reading order" })[n] || `check ${n}`;
