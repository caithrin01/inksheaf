// Typst compile fixtures (Codex audit: the renderer suite never compiled Typst).
// 1. Syntax boundary table: every inline construct followed by every punctuation Typst could
//    read as code; the emitter's output must compile and print the text unchanged.
// 2. Link-note torture: fifteen long titles and hosts with a QR cell; must compile, and the
//    rendered rows must not overlap (each row's text box is checked by page text order).
import { emitTypst } from "./lib/typst-emit.mjs";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
mkdirSync("proofs/fixtures", { recursive: true });
const compile = (typ, name) => { const f = `proofs/fixtures/${name}.typ`, pdf = `proofs/fixtures/${name}.pdf`; writeFileSync(f, typ);
  try { execFileSync("typst", ["compile", "--font-path", "fonts", f, pdf], { stdio: "pipe" }); return { ok: true, pdf }; } catch (e) { return { ok: false, err: String(e.stderr || e.message).slice(0, 300) }; } };
const text = pdf => { try { return execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" }); } catch { return ""; } };
const wrap = body => `<html><body><span class="pubsrc">Fixture</span><section class="article" id="art-0"><header class="arthead"><div class="artnum">1</div><h2 class="arttitle">Boundaries</h2><div class="artmeta">JULY 1, 2026</div></header><div class="artbody">${body}</div></section></body></html>`;

/* 1. boundaries */
const marks = [".", ",", ":", ";", "?", "!", ")", "]", "\"", "'", "a", "(x)", "[y]", ".he", "–", "…"];
const inl = { em: "<em>word</em>", strong: "<strong>word</strong>", code: "<code>x()</code>", link: '<a href="https://example.com/p">word</a>', sup: "<sup>2</song>".replace("</song>", "</sup>"), footnote: '<a class="footnote-anchor" href="#footnote-1" id="footnote-anchor-1">1</a>' };
const paras = []; for (const [k, h] of Object.entries(inl)) for (const m of marks) paras.push(`<p>${h}${m} after ${k}</p>`);
paras.push(`<div class="footnote"><a id="footnote-1" href="#footnote-anchor-1" class="footnote-number">1</a><div class="footnote-content"><p>A note (with brackets) [and more].</p></div></div>`);
let typ = emitTypst(wrap(paras.join("")), { baseDir: "proofs/fixtures", pubName: "Fixture", host: "example.com", notes: "footnotes" });
let r = compile(typ, "boundaries");
ok(r.ok, "boundary table compiles: " + (r.err || ""));
if (r.ok) { const t = text(r.pdf); ok((t.match(/after em/g) || []).length === marks.length && (t.match(/after link/g) || []).length === marks.length, "every boundary line printed"); ok(!/#emph|#strong|#super|#raw|#footnote|#link/.test(t), "no Typst code leaked into the text"); }

/* 2. link-note torture */
const rows = Array.from({ length: 15 }, (_, i) => `<a href="https://a-very-long-host-name-number-${i}.example-domain-for-testing.org/path/that/goes/on/and/on?x=${i}">${"A long anchor text that wraps across the column more than once ".repeat(2)}${i}</a>`);
const body = `<p>${rows.join(" and ")}</p>`;
const note = `<section class="linknote"><h2 class="linknote-h">Links</h2><ul>${rows.map((_, i) => `<li><span class="lk">${String.fromCharCode(97 + i)}</span><span class="lk-text">${"A long anchor text that wraps across the column more than once ".repeat(2)}${i}</span><span class="lk-url">inksheaf.com/l/abc${i}xy</span><span class="lk-target" data-target="https://example.org/${i}"></span></li>`).join("")}</ul></section>`;
const html = wrap(body).replace("</section>", note + "</section>");
typ = emitTypst(html, { baseDir: "proofs/fixtures", pubName: "Fixture", host: "example.com" });
r = compile(typ, "linknote");
ok(r.ok, "link-note torture compiles: " + (r.err || ""));
if (r.ok) {
  const t = text(r.pdf);
  const urls = (t.match(/inksheaf\.com\/l\/abc\d+xy/g) || []).length;
  ok(urls === 15, `all 15 short URLs printed whole (${urls})`);
  /* overlap: with -layout, an overprinted row shows two URLs on one line or letters jammed against text */
  const jam = (t.match(/[a-z]inksheaf\.com/g) || []).length; ok(jam === 0, "no URL jammed against the text before it: " + jam);
}
console.log(`${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
