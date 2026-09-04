#!/usr/bin/env node
// Unit gate for the page review plumbing: rasters, labelled contact sheets, pass-1 parsing,
// pass-2 confirmation, tolerance of model failure, and the no-key skip. The model is a stub.
import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { reviewPdf, rasterise, contactSheets, parseJson, writerLine, operatorBlock, CHECKS } from "./lib/page-review.mjs";

let n = 0; const ok = (name, c, d = "") => { n++; assert.ok(c, name + (d ? " :: " + d : "")); console.log("ok   " + name); };
const dir = mkdtempSync(join(tmpdir(), "page-review-test-"));
const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.TimesRoman);
for (let i = 1; i <= 6; i++) { const p = doc.addPage([432, 648]); p.drawText(`Page ${i}. ` + "Body text set in a book face. ".repeat(i === 3 ? 1 : 12), { x: 54, y: 580, size: 11, font, maxWidth: 324, lineHeight: 14 }); }
const pdf = join(dir, "six.pdf"); writeFileSync(pdf, await doc.save());

const pages = rasterise(pdf, join(dir, "pages"));
ok("six pages rasterised in order", pages.length === 6 && /p-1\.png$/.test(pages[0]) && /p-6\.png$/.test(pages[5]));
const sheets = contactSheets(pages, join(dir, "sheets"));
ok("two contact sheets, four then two pages", sheets.length === 2 && sheets[0].pages.join() === "1,2,3,4" && sheets[1].pages.join() === "5,6" && existsSync(sheets[1].file));

ok("parseJson takes a fenced array", Array.isArray(parseJson("```json\n[{\"page\":3,\"check\":1}]\n```")));
ok("parseJson takes prose around an object", parseJson("Sure. {\"confirmed\": true, \"note\": \"x\"} hope that helps")?.confirmed === true);
ok("parseJson gives null on nothing", parseJson("no idea") === null);

/* a stub model: pass 1 flags page 3 (blank) at .8 and page 5 (figure) at .2 (below threshold),
   plus a page outside the sheet (ignored); pass 2 confirms page 3 */
const calls = [];
const ask = async ({ model, images, text }) => {
  calls.push({ model, images: images.length, image: images[0], text: text.slice(0, 40) });
  if (/contact sheet/.test(text)) return { text: text.includes("page 1,") ? '[{"page":3,"check":1,"note":"mostly empty","confidence":0.8},{"page":5,"check":3,"note":"maybe","confidence":0.2},{"page":9,"check":7,"note":"outside","confidence":0.9}]' : "[]", usage: { prompt_tokens: 700, completion_tokens: 40 } };
  return { text: '{"confirmed": true, "note": "two thirds of the page is empty and it is not a closer"}', usage: { prompt_tokens: 900, completion_tokens: 20 } };
};
const r = await reviewPdf(pdf, { outDir: join(dir, "run"), ask, pass1Model: "stub-1", pass2Model: "stub-2", key: "stub" });
ok("pass 1 ran once per sheet", r.pass1.calls === 2, JSON.stringify(calls));
ok("only in-sheet flags over the threshold reach pass 2", r.pass1.flagged === 1 && r.pass2.calls === 1);
ok("pass 2 got the single page at full size", calls[2].model === "stub-2" && calls[2].images === 1);
ok("pass 2 was shown the flagged page itself (regression: shared raster dir handed it page 4)", /\/3\/p-0?3\.png$/.test(calls[2].image));
ok("confirmed finding reported with page, check and both notes", r.findings.length === 1 && r.findings[0].page === 3 && r.findings[0].check === 1 && r.findings[0].pass1 === "mostly empty");
ok("usage summed", r.usage.prompt_tokens === 2300 && r.usage.completion_tokens === 100);
ok("review.json written", existsSync(join(r.dir, "review.json")));
ok("writer line names the page and the check", /all 6 pages/.test(writerLine(r)) && /p\. 3 \(blank space\)/.test(writerLine(r)));
ok("operator block carries counts and the finding", /pass1 stub-1 flagged 1/.test(operatorBlock(r)) && /p\.3 check 1/.test(operatorBlock(r)));

/* pass 2 dismisses: nothing reported, the dismissal kept */
const r2 = await reviewPdf(pdf, { outDir: join(dir, "run2"), ask: async ({ text }) => /contact sheet/.test(text) ? { text: '[{"page":2,"check":6,"note":"boxes","confidence":0.9}]' } : { text: '{"confirmed": false, "note": "clean Times, no boxes"}' }, key: "stub" });
ok("a dismissed flag is not a finding", r2.findings.length === 0 && r2.dismissed.length === 1 && r2.pass2.dismissed === 1);
ok("writer line says nothing flagged", /flagged nothing/.test(writerLine(r2)));

/* the model is down: no throw, errors recorded, empty findings, writer line empty */
const r3 = await reviewPdf(pdf, { outDir: join(dir, "run3"), ask: async () => { throw new Error("HTTP 503"); }, key: "stub" });
ok("model failure never throws and is counted", r3.findings.length === 0 && r3.pass1.errors === 2 && r3.errors.length === 2);
ok("no writer line when nothing was read", writerLine(r3) === "");

/* garbage answers are tolerated */
const r4 = await reviewPdf(pdf, { outDir: join(dir, "run4"), ask: async () => ({ text: "I cannot see the image." }), key: "stub" });
ok("unparseable answers are errors, not findings", r4.findings.length === 0 && r4.pass1.errors === 2);

/* a truncated pass-2 answer still yields its verdict */
const r6 = await reviewPdf(pdf, { outDir: join(dir, "run6"), ask: async ({ text }) => /contact sheet/.test(text) ? { text: '[{"page":2,"check":3,"note":"box","confidence":0.9}]' } : { text: '{"confirmed": true, "note": "a dashed placeholder box where the photo should' }, key: "stub" });
ok("truncated pass-2 JSON still counts as confirmed", r6.findings.length === 1 && r6.pass2.errors === 0 && /dashed placeholder/.test(r6.findings[0].note));

/* no key: skipped, nothing rasterised */
const r5 = await reviewPdf(pdf, { outDir: join(dir, "run5"), key: "" });
ok("no key skips the review with a reason", r5.skipped === "no OPENROUTER_API_KEY" && r5.pages === 0);
ok("operator block says skipped", /skipped/.test(operatorBlock(r5)) && writerLine(r5) === "");

ok("eight checks in the list", Object.keys(CHECKS).length === 8);
console.log(`page-review: ${n} pass, 0 fail`);
