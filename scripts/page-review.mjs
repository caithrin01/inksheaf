#!/usr/bin/env node
// page-review.mjs <book.pdf> [--out dir] [--pass1 model] [--pass2 model] [--json]
// A model reads every page of a proof (plan-page-review-v1). Prints the confirmed findings.
import { reviewPdf, writerLine, operatorBlock } from "./lib/page-review.mjs";
const args = process.argv.slice(2);
const pdf = args.find(a => !a.startsWith("--"));
if (!pdf) { console.error("usage: page-review.mjs <book.pdf> [--out dir] [--pass1 model] [--pass2 model] [--json]"); process.exit(2); }
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const r = await reviewPdf(pdf, { outDir: opt("--out"), pass1Model: opt("--pass1"), pass2Model: opt("--pass2"), log: m => console.error(m) });
if (args.includes("--json")) { console.log(JSON.stringify(r, null, 1)); }
else { console.log(operatorBlock(r)); console.log(); console.log(writerLine(r) || "(no writer line: review did not run)"); if (r.dir) console.log(`\nartifacts: ${r.dir}`); }
process.exit(0);
