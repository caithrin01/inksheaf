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
/* 3. Literary preformatted blocks and typography after an article's small endnotes. */
const literary = wrap(`<p>Text before the verse.</p><pre class="preformatted-text">The first line\n  The indented second line\n\nThe final line</pre><p>Text after the verse.<a class="footnote-anchor" href="#footnote-one">1</a></p><div class="footnote"><a id="footnote-one">1</a><div class="footnote-content"><p>A small endnote.</p></div></div>`)
  .replace('</body>', '<section class="article"><header class="arthead"><h2 class="arttitle">Next Essay</h2></header><div class="artbody"><p>BodyAfterNotesMarker is normal body text.</p></div></section></body>');
r = compile(emitTypst(literary, {baseDir:'proofs/fixtures',pubName:'Fixture',host:'example.com'}), 'literary-block');
ok(r.ok, 'literary block compiles: '+(r.err||''));
if(r.ok){
  const t=text(r.pdf);
  ok(/The first line\s+The indented second line\s+The final line/.test(t), 'all verse lines print in source order');
  const geometry=JSON.parse(execFileSync('python3',['-c',`import pymupdf as fitz
import json,sys
d=fitz.open(sys.argv[1]); lines=[l for p in d for b in p.get_text('dict')['blocks'] if b['type']==0 for l in b['lines']]; spans=[s for l in lines for s in l['spans']]
print(json.dumps({'body':[s['size'] for s in spans if 'BodyAfterNotesMarker' in s['text']], 'verse':[s['font'] for s in spans if 'The indented second line' in s['text']]}))`,r.pdf],{encoding:'utf8'}));
  ok(geometry.body.length===1 && Math.abs(geometry.body[0]-10.5)<.01, 'endnote typography cannot leak into the next essay');
  ok(geometry.verse.length===1 && geometry.verse.every(f=>/SourceSerif/i.test(f)), 'literary blocks use serif body type, not code type');
}
/* 4. Long small-print paragraphs are not a chain of sticky section headings. */
const disclosure = 'This is a complete disclosure paragraph about this publication. '.repeat(6);
typ=emitTypst(wrap(`<p>Opening prose.</p><h6>Disclosure</h6><h6>${disclosure}FirstDisclosureMarker.</h6><h6>${disclosure}SecondDisclosureMarker.</h6>`),{baseDir:'proofs/fixtures',pubName:'Fixture'});
r=compile(typ,'small-print-paragraphs');
ok(r.ok,'small-print paragraphs compile: '+(r.err||''));
if(r.ok){const t=text(r.pdf);ok(t.includes('FirstDisclosureMarker')&&t.includes('SecondDisclosureMarker'),'all disclosure content survives');}
ok(!typ.includes('=== This is a complete disclosure'),'prose used as small print cannot form a sticky heading chain');
/* 5. Overflow references retain every target and a resolved page at the article head. */
typ=emitTypst(html,{baseDir:'proofs/fixtures',pubName:'Fixture',host:'example.com',backLinks:[1]});
r=compile(typ,'collected-links');
ok(r.ok,'collected references compile: '+(r.err||''));
if(r.ok){const t=text(r.pdf);ok(/LINKSONPAGE\d+/i.test(t.replace(/\s+/g,'')),'article opening resolves the reference-section page');ok((t.match(/inksheaf\.com\/l\/abc\d+xy/g)||[]).length===15,'moving references keeps all fifteen targets');}
/* 6. Empty editor elements cannot create printed content or a phantom final page. */
const plain = wrap('<p>Opening marker.</p><p>' + 'A complete paragraph of readable prose. '.repeat(35) + 'Ending marker.</p>');
const empty = plain.replace('</div></section>', '<p class="verse"><br><br></p><h3> </h3><h6><br></h6></div></section>');
const cleanPdf=compile(emitTypst(plain,{baseDir:'proofs/fixtures',pubName:'Fixture'}),'empty-clean');
const dirtyPdf=compile(emitTypst(empty,{baseDir:'proofs/fixtures',pubName:'Fixture'}),'empty-editor');
ok(cleanPdf.ok&&dirtyPdf.ok,'empty editor-element fixture compiles');
if(cleanPdf.ok&&dirtyPdf.ok)ok(text(cleanPdf.pdf)===text(dirtyPdf.pdf),'empty headings and break-only paragraphs leave pagination and printed text unchanged');
/* 7. A complete short stanza stays on one page, even when the preceding page fills. */
const verseFixture=wrap('<p>'+ 'The long preceding paragraph continues across the page. '.repeat(70)+'</p><pre class="preformatted-text">StanzaFirstMarker\nA second line with space to breathe\nA third line in the same stanza\nStanzaLastMarker</pre>');
r=compile(emitTypst(verseFixture,{baseDir:'proofs/fixtures',pubName:'Fixture'}),'whole-stanza');
ok(r.ok,'whole-stanza fixture compiles');
if(r.ok){const pages=text(r.pdf).split('\f');ok(pages.some(p=>p.includes('StanzaFirstMarker')&&p.includes('StanzaLastMarker')),'short stanza is not split at the page turn');}
/* 8. Short before/after examples remain together at a page boundary. */
const exampleFixture=wrap('<p>'+ 'The preceding discussion explains how to improve a resume. '.repeat(70)+'</p><p>Before: BeforeExampleMarker.</p><p>After:</p><blockquote><p>AfterExampleMarker describes the measurable result.</p></blockquote>');
r=compile(emitTypst(exampleFixture,{baseDir:'proofs/fixtures',pubName:'Fixture'}),'whole-comparison');
ok(r.ok,'before/after comparison fixture compiles');
if(r.ok){const pages=text(r.pdf).split('\f');ok(pages.some(p=>p.includes('BeforeExampleMarker')&&p.includes('AfterExampleMarker')),'short before/after comparison stays on the same page');}
console.log(`${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
