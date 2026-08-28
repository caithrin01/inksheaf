#!/usr/bin/env node
// Imposition: turn the sequential book PDF into (a) a reader-spreads edition that displays
// as an open book, and (b) a printer booklet edition whose sheets fold back-to-front correctly.
//
// Usage: node scripts/impose.mjs proofs/book.pdf [--signature-pages N] [--long-edge]
//   writes  book-spreads.pdf  and  book-booklet.pdf  beside the input.
//
// The math (page numbers are 1-based; trim 6x9in = 432x648pt; sheets 12x9in = 864x648pt):
//   SPREADS: cover alone on the recto; then [2|3], [4|5], ... even=verso(left), odd=recto(right).
//   BOOKLET: pages are grouped into signatures of P pages (P % 4 == 0; the last signature is the
//   remainder padded with blanks to a multiple of 4). Within one signature, renumbered 1..P,
//   sheet s of P/4 carries  FRONT [P-2s+2 | 2s-1]  and  BACK [2s | P-2s+1].
//   Example P=8: F[8|1] B[2|7] F[6|3] B[4|5] — folded, it reads 1..8.
//   Duplex: print two-sided with SHORT-EDGE flip (the default here); --long-edge rotates the
//   back sides 180 degrees for printers that only flip on the long edge.
//   Signatures default: one signature when the padded book is 48 pages or fewer (saddle staple),
//   otherwise 16-page signatures (classic sewn sections, stacked in order).
//   Perfect-bound POD (Lulu) needs NEITHER of these: it takes the sequential file + separate cover.

import { PDFDocument, degrees } from "pdf-lib";
import { readFileSync, writeFileSync } from "node:fs";

const input = process.argv[2];
if (!input) { console.error("usage: impose.mjs <book.pdf> [--signature-pages N] [--long-edge]"); process.exit(2); }
const sigIdx = process.argv.indexOf("--signature-pages");
const LONG_EDGE = process.argv.includes("--long-edge");

const SHEET_W = 864, SHEET_H = 648, PAGE_W = 432;

const src = await PDFDocument.load(readFileSync(input));
const N = src.getPageCount();

async function makeDoc(placements) {
  // placements: array of sheets; each sheet = {left: pageNo|null, right: pageNo|null, rotate?: bool}
  const out = await PDFDocument.create();
  const needed = [...new Set(placements.flatMap(p => [p.left, p.right]).filter(Boolean))].sort((a, b) => a - b);
  const embedded = await out.embedPdf(src, needed.map(n => n - 1));
  const byPage = Object.fromEntries(needed.map((n, i) => [n, embedded[i]]));
  for (const sheet of placements) {
    const pg = out.addPage([SHEET_W, SHEET_H]);
    for (const [slot, x] of [["left", 0], ["right", PAGE_W]]) {
      const n = sheet[slot];
      if (!n) continue;
      if (sheet.rotate) {
        // 180-degree rotation for long-edge duplex: draw rotated about the slot center
        pg.drawPage(byPage[n], { x: x + PAGE_W, y: SHEET_H, rotate: degrees(180) });
      } else {
        pg.drawPage(byPage[n], { x, y: 0 });
      }
    }
  }
  return out;
}

/* ---------- reader spreads ---------- */
const spreads = [{ left: null, right: 1 }];
for (let p = 2; p <= N; p += 2) spreads.push({ left: p, right: p + 1 <= N ? p + 1 : null });
const spreadsDoc = await makeDoc(spreads);
const spreadsOut = input.replace(/\.pdf$/i, "-spreads.pdf");
writeFileSync(spreadsOut, await spreadsDoc.save());

/* ---------- printer booklet ---------- */
const padTo4 = n => Math.ceil(n / 4) * 4;
const defaultSig = padTo4(N) <= 48 ? padTo4(N) : 16;
const SIG = sigIdx > -1 ? +process.argv[sigIdx + 1] : defaultSig;
if (SIG % 4) { console.error("--signature-pages must be a multiple of 4"); process.exit(2); }

const sheets = [];
let start = 1, sigCount = 0;
while (start <= N) {
  const remaining = N - start + 1;
  const P = Math.min(SIG, padTo4(remaining));
  sigCount++;
  const page = i => (start + i - 1 <= N ? start + i - 1 : null); // i is 1..P within signature; pad -> blank
  for (let s = 1; s <= P / 4; s++) {
    sheets.push({ left: page(P - 2 * s + 2), right: page(2 * s - 1) });                       // front
    sheets.push({ left: page(2 * s), right: page(P - 2 * s + 1), rotate: LONG_EDGE });        // back
  }
  start += P;
}
const bookletDoc = await makeDoc(sheets);
const bookletOut = input.replace(/\.pdf$/i, "-booklet.pdf");
writeFileSync(bookletOut, await bookletDoc.save());

console.log(JSON.stringify({
  input, pages: N,
  spreads: { file: spreadsOut, sheets: spreads.length },
  booklet: { file: bookletOut, signaturePages: SIG, signatures: sigCount,
    physicalSheets: sheets.length / 2, sides: sheets.length,
    duplex: LONG_EDGE ? "long-edge (backs rotated)" : "short-edge" },
}, null, 1));
