// Page review: a model reads every page of a proof before the writer does (plan-page-review-v1,
// asked by Caithrin 2026-08-28, 2026-09-02 twice, 2026-09-03; built 2026-09-04).
//
// Pass 1: every page, four to a contact sheet, a cheap document-vision model answers a fixed
// checklist with page numbers. Pass 2: each flagged page alone, at higher resolution, a stronger
// model confirms or dismisses. Only confirmed findings are reported. The review annotates; it
// records model failures. The publisher orchestrator holds delivery until review is complete.
import { auditRunningMatter } from "./running-matter.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";

export const CHECKS = {
  1: "Blank space: more than 30% of the body-layout area unused without a clear design reason. Include sparse essay endings. A short poem, deliberate section opening or necessary end matter may justify space; identify the reason instead of exempting every last page.",
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
  // A repaired or resumed PDF may be shorter; old rasters must not become phantom pages.
  for (const name of readdirSync(dir)) if (/^p-\d+\.png$/.test(name)) unlinkSync(join(dir,name));
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
export function contactSheets(pages, dir, {format="jpeg"}={}) {
  mkdirSync(dir, { recursive: true });
  const groups = [];
  for (let i = 0; i < pages.length; i += 4) groups.push(pages.slice(i, i + 4));
  const spec = groups.map((g, i) => ({ out: join(dir, `sheet-${String(i + 1).padStart(3, "0")}.${format==="png"?"png":"jpg"}`), tiles: g.map(f => ({ file: f, page: pageOf(f) })) }));
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
    sheet.save(s["out"],"PNG" if s["out"].endswith(".png") else "JPEG",quality=82)
print(len(spec))
`;
  execFileSync("python3", ["-c", py], { input: JSON.stringify(spec), stdio: ["pipe", "ignore", "pipe"] });
  return spec.map(s => ({ file: s.out, pages: s.tiles.map(t => t.page) }));
}

// Print-preservation checks compare the flagged PDF page with its actual source figures.
// These bounded, local PNG conversions introduce no generated or repaired source content.
function sourceComparisons(figures,dir){
  mkdirSync(dir,{recursive:true});
  const spec=figures.map((f,i)=>({source:f.source,out:join(dir,`source-${i+1}.png`)}));
  execFileSync('python3',['-c',`
import json,sys
from PIL import Image
for s in json.load(sys.stdin):
    im=Image.open(s['source']).convert('RGB');im.thumbnail((1800,1800));im.save(s['out'],'PNG')
`],{input:JSON.stringify(spec),stdio:['pipe','ignore','pipe']});
  return spec.map(s=>s.out);
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

const pass1Prompt = (pages,context) => `You are checking typeset book pages for production defects. This contact sheet holds ${pages.length} pages of a 6 by 9 inch book, in reading order: top-left is page ${pages[0]}, top-right page ${pages[1] ?? "-"}, bottom-left page ${pages[2] ?? "-"}, bottom-right page ${pages[3] ?? "-"}. Each tile carries its PHYSICAL PDF page number in a red label. Those labels are review references, NOT the printed folios. A book often starts folio 1 after its unnumbered front matter. Never call that normal offset a numbering defect.

Renderer page map: ${JSON.stringify(context)}. When folio_map_available is true, expected_printed_folio names the intended visible folio; null means this structural leaf has no printed folio. Use the supplied position to distinguish front-matter versos from blanks interrupting an article.

When running_head_map_available is true, compare the head with expected_running_head (case-insensitive); null means no head. This design alternates the publication on left pages and the current essay on right pages. Those different labels are intentional.

Look for only these defects:
${checklist()}

Printed source cards for videos and attachments, including their readable URLs, are intentional web-to-print treatments, not raw markup. A screenshot may deliberately illustrate faulty AI output; source-image spelling is not a missing-font defect. Judge space by its actual purpose. A complete short piece, title, contents, part-title, dedication or necessary end matter may justify space; identify that purpose. Do not exempt every chapter opener or closer: a stranded ending or unexplained gap inside running text still needs review. A blank verso in front matter or at a section boundary can be intentional; a blank page interrupting running text is a defect. Structural whitespace never excuses another defect such as overflow, a missing image or a wrong running head.

Answer with a JSON array and nothing else. Each element: {"page": <number>, "check": <1-8>, "note": "<one sentence>", "confidence": <0 to 1>}. An empty array [] when nothing is wrong.`;

export const pass2Prompt = (f,context,sources,neighbours) => `The first image is page ${f.page} of a typeset 6 by 9 inch book at full size. This is a PHYSICAL PDF page number, not its printed folio. Renderer page map: ${JSON.stringify(context)}. Use the intended folio and structural position when supplied; do not assume folio equals physical page number. A first reader flagged it under check ${f.check}: "${CHECKS[f.check] || ""}" with the note: "${f.note}".

When running_head_map_available is true, compare with expected_running_head, ignoring case and small-cap styling. Null means no running head. Alternating publication and essay heads are intended; do not demand the essay title on a publication-head page.

For check 2, paragraph_boundaries contains actual printed first/last lines and line counts, grouped using compiled source-paragraph anchors. Count paragraph lines on each side of the turn, not words in the final line. A paragraph with several lines on both pages has no single-line fragment. A complete one-line source paragraph is different from a split paragraph; inspect whether it acts as a stranded heading. An end anchor on the next page with zero printed lines is not proof of continuation. Unknown evidence cannot clear a heading, caption or ambiguous boundary.

${neighbours.length ? 'Additional images show neighbouring pages: '+neighbours.map((p,i)=>'image '+(i+2)+' = physical page '+p).join('; ')+'. Check the actual continuation across this boundary. A hyphenated word or mid-sentence page break is normal when the paragraph continues with several lines. A single paragraph line stranded alone is different. Two or more continuation lines are not a single-line widow. A figure interrupting the continuation is a reading-order defect. A labelled reference continuing from the preceding page is source apparatus, not raw markup; a stranded reference still needs a layout repair.' : ''}

${sources.length ? 'The first image is the printed page. Additional images are the actual source figures used on this page, in order: '+sources.map((s,i)=>'image '+(i+2)+' = '+s.id).join('; ')+'. Compare against those sources. Preserve deliberately cropped photos or screenshots of bad text: source content must not be reconstructed or rewritten. Loss introduced by the print layout, or essential detail made unreadable in print, is still a defect.' : 'No separate source-image comparison is available; do not assume source-image spelling was introduced by typesetting.'}

${f.check===6&&sources.length?'For this glyph check, first locate the flagged lettering in each separate source image. If the same lettering is already visible there, it is part of the original bitmap: return confirmed:false and origin:source_content. Scaling a bitmap cannot introduce a character-encoding substitution. Confirm rendered_layout only for a change introduced in print, such as broken typeset prose; uncertainty remains uncertain.':''}

Look at the page carefully and decide whether the SPECIFIC flagged defect is present. The first reader's note must match its assigned check; do not confirm a different defect under that code. Plain readable URLs in labelled video/attachment cards are valid source notes, not raw markup. Screenshots illustrating an essay about faulty AI output may intentionally show broken text; that is different from a font/encoding failure introduced into the typeset prose. Describe what you see. For check 1, a complete short piece or dedicated front/end matter can justify space; a stranded article tail is not automatically exempt. For every other check, the page's structural purpose does not excuse the defect. A placeholder or "could not be retrieved" text in place of an image is a defect. Do not dismiss image, overflow, glyph or running-head defects merely because the page is an opener or closer.

Classify origin as rendered_layout, source_content or uncertain. source_content means the finding is entirely explained by faithfully preserved source material, with no additional print loss. An intentionally broken screenshot or original photo crop can qualify. Essential detail made unreadable by print scaling is rendered_layout. When intent/readability cannot be established, use uncertain.

Answer with one JSON object and nothing else, the note under 25 words: {"confirmed": true or false, "origin": "rendered_layout" or "source_content" or "uncertain", "note": "<what you see>"}.`;

/* the review. `ask` is injectable for tests. Never throws on model trouble: errors are recorded. */
export async function reviewPdf(pdf, { outDir, ask = askOpenRouter, pass1Model = PASS1_MODEL, pass2Model = PASS2_MODEL, minConfidence = 0.35, imageFormat = "jpeg", pageContext = [], sourceFigures = [], stopOnError = false, key = process.env.OPENROUTER_API_KEY, log = () => {} } = {}) {
  const started = Date.now();
  const out = { pdf, pages: 0, sheets: 0, pass1: { model: pass1Model, calls: 0, flagged: 0, errors: 0 }, pass2: { model: pass2Model, calls: 0, confirmed: 0, dismissed: 0, errors: 0 }, findings: [], dismissed: [], errors: [], usage: { prompt_tokens: 0, completion_tokens: 0 }, skipped: null, ms: 0 };
  if (!key && ask === askOpenRouter) { out.skipped = "no OPENROUTER_API_KEY"; return out; }
  const dir = outDir || join(process.env.TMPDIR || "/tmp", `page-review-${basename(pdf).replace(/\.pdf$/, "")}-${Date.now()}`);
  let pages;
  try { pages = rasterise(pdf, join(dir, "pages")); } catch (e) { out.errors.push(`rasterise: ${String(e.message).slice(0, 120)}`); out.ms = Date.now() - started; return out; }
  out.pages = pages.length;
  try { out.running_matter = auditRunningMatter(pdf,pageContext); }
  catch(e) { out.errors.push(`running matter: ${String(e.message).slice(0,120)}`); out.ms=Date.now()-started; return out; }
  const verifiedHeads=new Set(out.running_matter.filter(p=>p.verified).map(p=>p.page));
  const wrongHeads=new Set(out.running_matter.filter(p=>!p.verified).map(p=>p.page));
  for(const p of out.running_matter.filter(p=>!p.verified))out.findings.push({page:p.page,check:5,confidence:1,origin:'measured_layout',note:`Printed ${[!p.head_matches&&'running head',!p.folio_matches&&'folio'].filter(Boolean).join(' and ')} differs from the compiled page map.`});
  let sheets;
  try { sheets = contactSheets(pages, join(dir, "sheets"), {format:imageFormat}); } catch (e) { out.errors.push(`contact sheets: ${String(e.message).slice(0, 120)}`); out.ms = Date.now() - started; return out; }
  out.sheets = sheets.length;
  const flagged = [];
  for (const s of sheets) {
    if(stopOnError&&out.errors.length)break;
    try {
      const r = await ask({ model: pass1Model, images: [s.file], text: pass1Prompt(s.pages,pageContext.filter(p=>s.pages.includes(p.page))), maxTokens: 800 });
      out.pass1.calls++; addUsage(out, r.usage);
      const arr = parseJson(r.text);
      if (!Array.isArray(arr)) { out.pass1.errors++; out.errors.push(`pass1 sheet ${s.pages[0]}: unparseable answer`); continue; }
      for (const f of arr) {
        const page = Number(f.page), check = Number(f.check), conf = Number(f.confidence);
        if (!s.pages.includes(page) || !CHECKS[check] || !Number.isFinite(conf) || conf<0 || conf>1 || typeof f.note!=='string') {
          out.pass1.errors++; out.errors.push(`pass1 sheet ${s.pages[0]}: invalid page/check finding`); continue;
        }
        if (conf < minConfidence) continue;
        flagged.push({ page, check, note: String(f.note || "").slice(0, 200), confidence: Math.round(conf * 100) / 100 });
      }
    } catch (e) { out.pass1.errors++; out.errors.push(`pass1 sheet ${s.pages[0]}: ${String(e.message).slice(0, 120)}`); }
    log(`pass1 sheet ${s.pages[0]}-${s.pages[s.pages.length - 1]}: ${flagged.length} flagged so far`);
  }
  /* Confirm each distinct defect. Dismissing whitespace must not discard overflow on the same page. */
  const byPage = new Map();
  for (const f of flagged.sort((a, b) => b.confidence - a.confidence)) if (!byPage.has(`${f.page}:${f.check}`)) byPage.set(`${f.page}:${f.check}`, f);
  out.pass1.flagged = byPage.size;
  for (const f of byPage.values()) {
    const boundary=pageContext.find(p=>p.page===f.page)?.paragraph_boundaries;
    if(f.check===2&&boundary?.verified_no_single_line_fragment){
      out.dismissed.push({...f,origin:'measured_layout',paragraph_boundaries:boundary,note:'Both page edges contain multiple printed lines of their anchored paragraphs; neither is a stranded heading or single-line fragment.'});
      continue;
    }
    // Check 5 is about label identity/presence. Actual glyphs decide it when both
    // renderer maps are available; unknown layouts still receive model review.
    if(f.check===5&&verifiedHeads.has(f.page)){
      out.dismissed.push({...f,origin:'measured_layout',note:'Actual printed running head and folio match the compiled page map.'});
      continue;
    }
    if(f.check===5&&wrongHeads.has(f.page))continue;
    if(stopOnError&&out.errors.length)break;
    let single;
    /* one directory per page: pdftoppm names by page number and a shared directory once handed
       pass 2 the first page rasterised for every flag (found on the first real run, 2026-09-04) */
    try { single = rasterise(pdf, join(dir, "single", String(f.page)), { scale: 1800, first: f.page, last: f.page }).find(x => pageOf(x) === f.page); if (!single) throw new Error("no raster"); } catch (e) { out.errors.push(`page ${f.page}: raster ${String(e.message).slice(0, 80)}`); continue; }
    try {
      const originals=[3,6].includes(f.check)?sourceFigures.filter(s=>s.page===f.page&&s.source).slice(0,3):[];
      const comparisons=originals.length?sourceComparisons(originals,join(dir,'source',String(f.page))):[];
      const neighbours=[2,7,8].includes(f.check)?[f.page-1,f.page+1].filter(p=>p>=1&&p<=out.pages):[];
      const adjacent=neighbours.map(p=>rasterise(pdf,join(dir,'adjacent',String(p)),{scale:1800,first:p,last:p})[0]);
      const r = await ask({ model: pass2Model, images: [single,...comparisons,...adjacent], text: pass2Prompt(f,pageContext.find(p=>p.page===f.page)||null,originals,neighbours), maxTokens: 400 });
      out.pass2.calls++; addUsage(out, r.usage);
      let j = parseJson(r.text);
      if (!j || typeof j.confirmed !== "boolean") { out.pass2.errors++; out.errors.push(`pass2 page ${f.page}: unparseable answer: ${String(r.text || "").replace(/\s+/g, " ").slice(0, 90)}`); continue; }
      const sourcePreserved=j.origin==='source_content'&&comparisons.length>0&&[3,6].includes(f.check);
      const rec = { page: f.page, check: f.check, note: String(j.note || f.note).slice(0, 200), pass1: f.note, confidence: f.confidence,
        ...(j.origin?{origin:j.origin}:{}),...(sourcePreserved?{source_preserved:true}:{}), source_comparisons:comparisons.length, neighbouring_pages:neighbours };
      if (j.confirmed&&!sourcePreserved) { out.findings.push(rec); out.pass2.confirmed++; } else { out.dismissed.push(rec); out.pass2.dismissed++; }
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
  if (r.errors.length) return `The page review is incomplete (${r.errors.length} check${r.errors.length===1?'':'s'} could not finish). ${n?`${n} page${n===1?'':'s'} also need a closer look.`:'The PDF is available for your own read.'}`;
  if (!n) return `A reader model checked all ${r.pages} pages and flagged nothing; your own read is still the one that counts.`;
  const list = r.findings.slice(0, 6).map(f => `p. ${f.page} (${shortCheck(f.check)})`).join(", ");
  return `A reader model checked all ${r.pages} pages and flagged ${n} page${n === 1 ? "" : "s"} worth a look: ${list}${n > 6 ? ", and more in the full list we keep" : ""}. If you agree, ask for a change below and we fix it before it prints.`;
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
