// HTML book -> Typst book. Reads the document build-book.mjs writes (front matter sections,
// section.article with .arthead/.artbody, parts, appendix, getmore) and emits a Typst source
// with the ivory design: 6 x 9, Source Serif 4 body, EB Garamond titles, running heads, floating
// figures (placement: auto, so an image that does not fit goes to the next page and the text
// flows on), page-foot footnotes or per-article endnotes by policy, a contents page with page
// numbers, and a page map (metadata labels) the blank-page measure uses to exempt closers.
// Spike and verdict: 05-Projects/Substack Magazine/research-formatting.md part 4 (2026-09-02).
import { parseDocument } from "htmlparser2";
import { readFileSync, existsSync } from "node:fs";
import * as fsMod from "node:fs";
import * as cryptoMod from "node:crypto";
import { dirname, resolve } from "node:path";

const RUBRIC = "#7d6448", FAINT = "#6b6457", RULE = "#b9b19d", INK = "#1e1710";
const isEl = n => n && n.type === "tag";
const cls = n => (isEl(n) && n.attribs && n.attribs.class) ? n.attribs.class.split(/\s+/) : [];
const has = (n, c) => cls(n).includes(c);
const attr = (n, a) => (isEl(n) && n.attribs && n.attribs[a]) || "";
const kids = n => (n && n.children) || [];
const textOf = n => n.type === "text" ? n.data : isEl(n) ? kids(n).map(textOf).join("") : "";
const q = n => { const c = kids(n).filter(k => isEl(k)); return c; };
const find = (n, pred) => { if (pred(n)) return n; for (const k of kids(n)) { const r = find(k, pred); if (r) return r; } return null; };
const findAll = (n, pred, out = []) => { if (pred(n)) out.push(n); for (const k of kids(n)) findAll(k, pred, out); return out; };

/* Typst markup escaping: every character that opens syntax, plus // (a comment) and a leading
   list or heading marker. Dashes are escaped in pairs so "--" is not turned into an en dash. */
export function esc(s) {
  let t = String(s ?? "").replace(/\\/g, "\\\\").replace(/([#$*_`\[\]<>@~])/g, "\\$1").replace(/\/\//g, "\\/\\/").replace(/--/g, "\\-\\-");
  t = t.replace(/^\s*([-+=\/])/, m => m.replace(/([-+=\/])/, "\\$1"));
  return t;
}
const str = s => JSON.stringify(String(s ?? "")); /* a Typst string literal */

/* image dimensions from the file header (JPEG SOF, PNG IHDR); null when unknown */
/* the image format from the bytes, since the cache names files by a guessed extension */
export function imageFormat(path) {
  try {
    const head = readFileSync(path).subarray(0, 16);
    if (head[0] === 0x89 && head[1] === 0x50) return "png";
    if (head[0] === 0xff && head[1] === 0xd8) return "jpg";
    if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return "gif";
    if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[8] === 0x57 && head[9] === 0x45) return "webp";
    if (/^\s*<(\?xml|svg)/.test(head.toString("latin1"))) return "svg";
  } catch {}
  return null;
}
export function imageSize(path) {
  try {
    const b = readFileSync(path);
    if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1]; const len = b.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        i += 2 + len;
      }
    }
  } catch {}
  return null;
}

export function emitTypst(html, opts = {}) {
  const { baseDir = "proofs", notes = "endnotes_per_article", textWidth = 4.53, textHeight = 7.44, fitFigs = {} } = opts;
  const doc = parseDocument(html);
  const body = find(doc, n => isEl(n) && n.name === "body") || doc;
  const pubSrc = find(body, n => has(n, "pubsrc")); const pubName = pubSrc ? textOf(pubSrc).trim() : (opts.pubName || "");
  let fnMap = new Map(), fnPolicy = notes, endnotes = [], out = [], backNotes = [], curTitle = "";

  /* a data: URI (the QR codes) becomes a file in the image cache; a relative path passes when it exists */
  function localImage(src) {
    if (!src) return null;
    if (src.startsWith("data:")) {
      const m = src.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/); if (!m) return null;
      const { createHash } = cryptoMod; const { mkdirSync, writeFileSync } = fsMod;
      const name = `.cache/img/qr-${createHash("sha1").update(m[2]).digest("hex").slice(0, 12)}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
      mkdirSync(resolve(baseDir, ".cache/img"), { recursive: true }); writeFileSync(resolve(baseDir, name), Buffer.from(m[2], "base64"));
      return name;
    }
    return existsSync(resolve(baseDir, src)) ? src : null;
  }

  /* ---- inline ---- */
  function inline(n, ctx = {}) {
    if (n.type === "text") return esc(n.data.replace(/\s+/g, " "));
    if (!isEl(n)) return "";
    const inner = () => kids(n).map(k => inline(k, ctx)).join("");
    switch (n.name) {
      case "em": case "i": return `#emph[${inner()}]`;
      case "strong": case "b": return `#strong[${inner()}]`;
      case "u": return `#underline[${inner()}]`;
      case "s": case "del": case "strike": return `#strike[${inner()}]`;
      case "sup": return `#super[${inner()}]`;
      case "sub": return `#sub[${inner()}]`;
      case "code": return `#raw(${str(textOf(n))})`;
      case "br": return " \\\n";
      case "a": {
        if (attr(n, "data-link")) return `${inner()}#super[${esc(attr(n, "data-link"))}]`;
        if (has(n, "fn") || has(n, "footnote-anchor")) {
          const num = textOf(n).trim(); const key = (attr(n, "href") || "").replace(/^#/, "");
          const note = fnMap.get(key);
          if (note && fnPolicy === "footnotes") return `#footnote[${note}]`;
          if (note) { endnotes.push({ num, note }); }
          return `#super[${esc(num)}]`;
        }
        const href = attr(n, "href"); const txt = inner();
        if (ctx.notes && href && /^https?:/.test(href) && !/^https?:\/\//.test(textOf(n).trim())) {
          const host = href.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
          return `${txt} #text(fill: faint)[(${esc(host)})]`;
        }
        return txt;
      }
      case "img": return ""; /* an image inside a paragraph is lifted out by the block pass */
      case "span": case "mark": case "small": case "abbr": case "cite": case "q": case "time": case "label": return inner();
      default: return inner();
    }
  }

  /* ---- blocks ---- */
  function figureOf(imgEl, caption) {
    const src = attr(imgEl, "src"); if (!src) return "";
    const path = resolve(baseDir, src); if (!existsSync(path)) return `#block(stroke: (dash: "dashed", paint: rgb("${RUBRIC}")), inset: 8pt, width: 100%, text(size: 8.5pt, fill: rgb("${FAINT}"))[An image could not be retrieved for this proof.])\n\n`;
    const fmt = imageFormat(path); if (!fmt) return `#block(stroke: (dash: "dashed", paint: rgb("${RUBRIC}")), inset: 8pt, width: 100%, text(size: 8.5pt, fill: rgb("${FAINT}"))[An image in a format print cannot use was left out.])\n\n`;
    const dim = imageSize(path); let size = `width: 100%`;
    if (dim && dim.w && dim.h) {
      const hAtFull = textWidth * dim.h / dim.w; const cap = textHeight * 0.72; /* an image never takes more than 72% of a page */
      if (hAtFull > cap) size = `height: ${cap.toFixed(2)}in`;
      else if (dim.w < 700) size = `width: ${Math.min(100, Math.round(dim.w / (textWidth * 150) * 100))}%`; /* small images stay small: 150 px per inch floor */
    }
    const capTxt = caption ? `, caption: [${caption}]` : "";
    const img = extra => `image(${str(src)}, format: ${str(fmt)}, ${extra})`;
    const id = attr(imgEl, "data-fig") || src;
    const tag = `#context [#metadata((id: ${str(id)}, page: here().page())) <fig>]\n`;
    /* a figure the fit loop asked to scale (it fell onto the page after a short one) sits in flow
       at the height that was left, so the page before it stays full; every other figure floats */
    const fitH = fitFigs[id];
    if (fitH) return `${tag}#figure(${img(`height: ${Number(fitH).toFixed(2)}in, width: auto`)}${capTxt})\n\n`;
    return `${tag}#figure(placement: auto, ${img(size)}${capTxt})\n\n`;
  }
  /* images inside list items are hoisted after the list: a float cannot live inside an item */
  let hoisted = [];
  function list(n, ordered, depth = 0) {
    const pad = "  ".repeat(depth); let s = "";
    for (const li of kids(n)) {
      if (isEl(li) && (li.name === "ul" || li.name === "ol")) { s += list(li, li.name === "ol", depth); continue; } /* a list nested directly in a list */
      if (!isEl(li) || li.name !== "li") continue;
      const sub = kids(li).filter(k => isEl(k) && (k.name === "ul" || k.name === "ol"));
      for (const im of findAll(li, k => isEl(k) && k.name === "img")) { const fig = im.parent && find(li, k => isEl(k) && k.name === "figure" && find(k, x => x === im)); const fc = fig && find(fig, k => isEl(k) && k.name === "figcaption"); hoisted.push(figureOf(im, fc ? kids(fc).map(k => inline(k)).join("").trim() : "")); }
      const own = kids(li).filter(k => !(isEl(k) && (k.name === "ul" || k.name === "ol" || k.name === "figure" || k.name === "img" || (k.name === "div" && find(k, x => isEl(x) && x.name === "img")))));
      const text = own.map(k => isEl(k) && k.name === "p" ? kids(k).map(x => inline(x)).join("") : inline(k)).join("").trim();
      s += `${pad}${ordered ? "+" : "-"} ${text || " "}\n`;
      for (const sl of sub) s += list(sl, sl.name === "ol", depth + 1);
    }
    return s;
  }
  function block(n) {
    if (n.type === "text") { const t = n.data.trim(); return t ? esc(t) + "\n\n" : ""; }
    if (!isEl(n)) return "";
    const c = cls(n);
    if (n.name === "script" || n.name === "style") return "";
    if (has(n, "footnote") && n.name === "div") return ""; /* collected beforehand */
    if (has(n, "footnote-container")) return "";
    if (has(n, "linknote")) {
      const items = findAll(n, k => isEl(k) && k.name === "li");
      const qr = find(n, k => isEl(k) && k.name === "img"); const qrSrc = qr ? localImage(attr(qr, "src")) : null;
      const shortEssay = textOf(find(n, k => has(k, "lk-essay")) || {}).trim();
      const rows = items.map(li => { const L = textOf(find(li, k => has(k, "lk")) || {}).trim(); const t = kids(find(li, k => has(k, "lk-text")) || li).map(x => inline(x)).join("").trim(); const u = textOf(find(li, k => has(k, "lk-url")) || {}).trim();
        const shown = /^https?:\\\/\\\//.test(t) || /^https?:\/\//.test(textOf(find(li, k => has(k, "lk-text")) || {}).trim()) ? esc(textOf(find(li, k => has(k, "lk-text")) || {}).trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0]) : t;
        return `[#super[${esc(L)}]], [${shown} #h(4pt) #text(fill: faint, size: 7.5pt)[${esc(u)}]]`; }).join(", ");
      return `#block(above: 1.2em, width: 100%, breakable: true)[#line(length: 100%, stroke: 0.5pt + rgb("${RULE}")) #v(0.35em) #text(size: 8pt, tracking: 0.2em, fill: rubric)[LINKS] #v(0.4em) #set text(size: 8.5pt, fill: rgb("#3a352c")); #set par(first-line-indent: 0em, justify: false)
#grid(columns: (1fr, ${qrSrc ? "0.95in" : "0pt"}), gutter: 10pt, [#grid(columns: (1.4em, 1fr), row-gutter: 0.28em, ${rows})], [${qrSrc ? `#image(${str(qrSrc)}, width: 0.85in) #v(-0.1em) #text(size: 6.5pt, fill: faint)[${esc(shortEssay)}]` : ""}])]\n\n`;
    }
    if (has(n, "srcnotes")) {
      const hEl = find(n, k => isEl(k) && /^h[2-4]$/.test(k.name)); const label = hEl ? textOf(hEl).trim() : "Sources & notes";
      const inner = kids(n).filter(k => !(isEl(k) && /^h[2-4]$/.test(k.name))).map(block).join("");
      const blk = `#block(above: 1.2em, width: 100%)[#line(length: 100%, stroke: 0.5pt + rgb("${RULE}")) #v(0.35em) #text(size: 8pt, tracking: 0.2em, fill: rubric)[${esc(label.toUpperCase())}] #v(0.4em) #set text(size: 8.5pt, fill: rgb("#3a352c")); #set par(first-line-indent: 0em, justify: false, hanging-indent: 0em); #set list(marker: [–], indent: 0em, body-indent: 0.5em)\n${inner}]\n\n`;
      if (fnPolicy === "back_of_book") { backNotes.push({ title: curTitle, blk }); return ""; }
      return blk;
    }
    if (has(n, "embedcard")) return `#block(width: 100%, inset: (left: 9pt, y: 6pt), stroke: (left: 2pt + rgb("${RUBRIC}")), text(size: 8.5pt, fill: rgb("${FAINT}"))[${kids(n).map(k => inline(k)).join("")}])\n\n`;
    if (has(n, "gifnote")) return `#align(center, text(size: 7.5pt, fill: rgb("${FAINT}"))[${kids(n).map(k => inline(k)).join("")}])\n\n`;
    if (has(n, "imgmissing")) return `#block(stroke: (dash: "dashed", paint: rgb("${RUBRIC}")), inset: 8pt, width: 100%, text(size: 8.5pt, fill: rgb("${FAINT}"))[${esc(textOf(n).trim())}])\n\n`;
    switch (n.name) {
      case "p": {
        const imgs = findAll(n, k => isEl(k) && k.name === "img");
        const t = kids(n).map(k => inline(k)).join("").trim();
        let s = "";
        for (const im of imgs) s += figureOf(im, "");
        if (t) s += (has(n, "verse") ? `#block(text(hyphenate: false)[${kids(n).map(k => inline(k)).join("")}])\n\n` : t + "\n\n");
        return s;
      }
      case "h1": case "h2": return `== ${kids(n).map(k => inline(k)).join("").trim()}\n\n`;
      case "h3": case "h4": case "h5": case "h6": return `=== ${kids(n).map(k => inline(k)).join("").trim()}\n\n`;
      case "ul": case "ol": { hoisted = []; const l = list(n, n.name === "ol"); const h = hoisted.join(""); hoisted = []; return l + "\n" + h; }
      case "blockquote": return `#quote(block: true)[\n${kids(n).map(block).join("").trim()}\n]\n\n`;
      case "pre": return `#raw(block: true, ${str(textOf(n).replace(/\n$/, ""))})\n\n`;
      case "hr": return `#v(0.4em)\n#align(center, text(fill: rgb("${RUBRIC}"), size: 10pt)[❦])\n#v(0.4em)\n\n`;
      case "img": return figureOf(n, "");
      case "figure": {
        const im = find(n, k => isEl(k) && k.name === "img"); const fc = find(n, k => isEl(k) && k.name === "figcaption");
        return im ? figureOf(im, fc ? kids(fc).map(k => inline(k)).join("").trim() : "") : kids(n).map(block).join("");
      }
      case "figcaption": return "";
      case "table": {
        const rows = findAll(n, k => isEl(k) && k.name === "tr"); if (!rows.length) return "";
        const ncol = Math.max(...rows.map(r => q(r).filter(x => x.name === "td" || x.name === "th").length));
        const cells = rows.flatMap(r => { const cs = q(r).filter(x => x.name === "td" || x.name === "th"); while (cs.length < ncol) cs.push(null);
          return cs.map(x => `[${x ? (x.name === "th" ? `#strong[${kids(x).map(k => inline(k)).join("")}]` : kids(x).map(k => inline(k)).join("")) : ""}]`); });
        return `#block(width: 100%, text(size: 8pt)[#table(columns: ${ncol}, stroke: 0.5pt + rgb("${RULE}"), ${cells.join(", ")})])\n\n`;
      }
      case "br": return "";
      case "a": return find(n, k => isEl(k) && k.name === "img") ? kids(n).map(block).join("") : (() => { const t = inline(n).trim(); return t ? t + "\n\n" : ""; })();
      case "div": case "section": case "article": case "main": case "header": case "footer": case "aside": case "nav": case "picture": case "span":
        return kids(n).map(block).join("");
      case "iframe": case "audio": case "video": case "source": case "button": case "form": case "input": case "svg": return "";
      default: {
        const t = kids(n).map(k => inline(k)).join("").trim(); return t ? t + "\n\n" : "";
      }
    }
  }

  /* ---- an article: collect its footnotes first, then head, body, endnotes ---- */
  function article(sec, index) {
    fnMap = new Map(); endnotes = [];
    for (const fn of findAll(sec, k => isEl(k) && k.name === "div" && has(k, "footnote"))) {
      const numEl = find(fn, k => isEl(k) && k.name === "a" && (attr(k, "id") || "").length);
      const id = numEl ? attr(numEl, "id") : ""; const content = find(fn, k => isEl(k) && has(k, "footnote-content")) || fn;
      const inner = kids(content).map(k => isEl(k) && k.name === "p" ? kids(k).map(x => inline(x)).join("") : inline(k)).filter(Boolean).join(" \\\n");
      if (id) fnMap.set(id, inner);
    }
    const head = find(sec, k => isEl(k) && has(k, "arthead"));
    const num = head && find(head, k => has(k, "artnum")); const title = head && find(head, k => has(k, "arttitle"));
    const sub = head && find(head, k => has(k, "artsub")); const meta = head && find(head, k => has(k, "artmeta"));
    const bodyEl = find(sec, k => isEl(k) && has(k, "artbody")) || sec;
    const T = title ? textOf(title).trim() : `Untitled ${index + 1}`; curTitle = T;
    let s = `#arthead(${num ? str(textOf(num).trim()) : "none"}, ${str(T)}, ${str(sub ? textOf(sub).trim() : "")}, ${str(meta ? textOf(meta).replace(/\s+/g, " ").trim() : "")})\n`;
    s += `#context [#metadata((n: ${index + 1}, page: here().page())) <artstart>]\n`;
    s += kids(bodyEl).map(block).join("");
    /* the link note sits after the body inside the section */
    s += kids(sec).filter(k => isEl(k) && has(k, "linknote")).map(block).join("");
    if (endnotes.length) {
      s += `#v(0.8em)\n#line(length: 30%, stroke: 0.5pt + rgb("${RULE}"))\n#v(0.3em)\n#set text(size: 8.5pt)\n#set par(first-line-indent: 0em)\n`;
      s += endnotes.map(e => `#box(width: 1.4em)[#super[${esc(e.num)}]] ${e.note}\n\n`).join("");
    }
    s += `#context [#metadata((n: ${index + 1}, page: here().page())) <artend>]\n`;
    return s + "\n";
  }

  /* ---- front and back matter ---- */
  const fm = { half: null, title: null, about: null, dedication: null, appendix: null, getmore: null, cover: null };
  const parts = []; const sections = [];
  for (const n of kids(body)) {
    if (!isEl(n)) continue;
    if (has(n, "cover")) fm.cover = n;
    else if (has(n, "halftitle")) fm.half = n;
    else if (has(n, "titlepage")) fm.title = n;
    else if (has(n, "about")) fm.about = n;
    else if (has(n, "dedication")) fm.dedication = n;
    else if (has(n, "appendix")) fm.appendix = n;
    else if (has(n, "getmore")) fm.getmore = n;
    else if (n.name === "section" && has(n, "part")) sections.push({ part: n });
    else if (n.name === "section" && has(n, "article")) sections.push({ article: n });
  }
  const tp = fm.title ? { t: textOf(find(fm.title, k => has(k, "t")) || fm.title).trim(), s: textOf(find(fm.title, k => has(k, "s")) || {}).trim(), a: textOf(find(fm.title, k => has(k, "a")) || {}).trim() } : { t: pubName, s: "", a: "" };
  const kindLine = fm.cover ? textOf(find(fm.cover, k => has(k, "kind")) || {}).trim() : "";
  const dates = fm.cover ? textOf(find(fm.cover, k => has(k, "dates")) || {}).trim() : tp.s;
  const foot = fm.cover ? textOf(find(fm.cover, k => has(k, "foot")) || {}).replace(/\s+/g, " ").trim() : "";

  const aboutBody = fm.about ? kids(fm.about).filter(k => isEl(k) && k.name !== "h3").map(k => has(k, "colophon") ? `#v(1em)\n#text(size: 8pt, fill: rgb("${FAINT}"))[${kids(k).map(x => inline(x)).join("")}]\n\n` : has(k, "epigraph") ? `#emph[${kids(k).map(x => inline(x)).join("")}]\n\n` : block(k)).join("") : "";
  const getmore = fm.getmore ? kids(fm.getmore).filter(k => isEl(k)).map(k => k.name === "h3" ? "" : has(k, "qr") ? (() => {
      const imgs = findAll(k, x => isEl(x) && x.name === "img"); const labels = textOf(k).replace(/\s+/g, " ").trim().split(/\s+/);
      return `#v(0.5in)\n#grid(columns: (1fr, 1fr), gutter: 12pt, ${imgs.map((im, i) => { const src = localImage(attr(im, "src"));
        return `align(center)[${src ? `#image(${str(src)}, width: 1.1in)` : ""} \\ #text(size: 8pt)[${esc(labels[i] || "")}]]`; }).join(", ")})\n\n`; })()
    : has(k, "morelinks") ? `#text(size: 9pt, fill: rgb("${FAINT}"))[${kids(k).map(x => inline(x)).join("")}]\n\n` : block(k)).join("") : "";

  const coverPage = fm.cover ? `#page(margin: 0in, header: none, footer: none, fill: rgb("#f9f4e6"))[
  #place(top + left, dx: 16pt, dy: 16pt, rect(width: 6in - 32pt, height: 9in - 32pt, stroke: 1.5pt + rgb("${INK}")))
  #place(top + left, dx: 22pt, dy: 22pt, rect(width: 6in - 44pt, height: 9in - 44pt, stroke: 1pt + rgb("#a93b22")))
  #align(center)[#v(1.6in) #text(font: "EB Garamond 12", size: 34pt, fill: rgb("${INK}"))[${esc(tp.t)}] #v(0.25in) #text(size: 8pt, tracking: 0.32em, fill: rgb("#a93b22"))[${esc(kindLine.toUpperCase())}] #v(0.2in) #text(fill: rgb("#a93b22"), size: 14pt)[❧] #v(0.2in) #text(size: 12pt, fill: rgb("${FAINT}"))[${esc(dates)}]]
  #place(bottom + center, dy: -0.85in, text(size: 8pt, tracking: 0.2em, fill: rgb("${FAINT}"))[${esc(foot.toUpperCase())}])
]\n` : "";

  const template = `// Generated by scripts/lib/typst-emit.mjs from the builder's HTML. Do not edit by hand.
#let arttitle = state("arttitle", "")
#let rubric = rgb("${RUBRIC}")
#let faint = rgb("${FAINT}")
#set page(width: 6in, height: 9in, margin: (inside: 0.85in, outside: 0.62in, top: 0.78in, bottom: 0.78in),
  header: context { if counter(page).get().first() > 1 [ #set text(size: 7.5pt, tracking: 0.14em, fill: faint); #if calc.even(here().page()) [#smallcaps[${esc(pubName.toLowerCase())}]] else [#h(1fr) #emph(text(tracking: 0em, size: 8pt)[#arttitle.get()])] ] },
  footer: context [ #align(center, text(size: 8.5pt, fill: faint)[#counter(page).display()]) ])
#set text(font: "Source Serif 4", size: 10.5pt, lang: "en", hyphenate: true, fill: rgb("${INK}"))
#set par(justify: true, leading: 0.66em, first-line-indent: 1.35em, spacing: 0.66em)
#set heading(numbering: none, outlined: false)
#show heading.where(level: 1): it => { }
#show heading.where(level: 2): it => block(sticky: true, above: 1.1em, below: 0.5em, text(size: 12pt, weight: 600, it.body))
#show heading.where(level: 3): it => block(sticky: true, above: 1em, below: 0.4em, text(size: 11pt, weight: 600, it.body))
#show figure: set block(above: 1em, below: 1em)
#show figure.caption: it => text(size: 8.5pt, fill: faint, it.body)
#show quote.where(block: true): set pad(x: 1.2em)
#show quote.where(block: true): set text(size: 9.8pt)
#show raw.where(block: true): it => block(width: 100%, fill: rgb("#f4efe4"), inset: 6pt, text(size: 8pt, it))
#show raw.where(block: false): set text(size: 8.5pt)
#set list(indent: 1em, spacing: 0.5em)
#set enum(indent: 1em, spacing: 0.5em)
#set footnote.entry(separator: line(length: 30%, stroke: 0.5pt + rgb("${RULE}")), indent: 0em, gap: 0.5em)
#show footnote.entry: set text(size: 8.5pt)
#let arthead(n, title, sub, meta) = {
  pagebreak(weak: true)
  arttitle.update(title)
  v(0.55in)
  if n != none { text(font: "EB Garamond 12", size: 30pt, fill: rubric)[#n]; v(0.15em) }
  heading(level: 1, title)
  block(text(font: "EB Garamond 12", size: 18pt, weight: 500, title))
  if sub != "" { block(above: 0.45em, text(size: 10.5pt, style: "italic", fill: faint, sub)) }
  block(above: 0.7em, below: 1.1em, [#text(size: 8pt, tracking: 0.14em, fill: faint)[#upper(meta)] #v(0.45em) #line(length: 100%, stroke: 0.5pt + rgb("${RULE}"))])
}
#let partpage(kind, title) = page(header: none, footer: none)[ #v(2.9in) #align(center)[#text(size: 8.5pt, tracking: 0.2em, fill: rubric)[#upper(kind)] #v(0.4em) #text(font: "EB Garamond 12", size: 22pt)[#title]] ]
#let fmpage(body) = page(header: none, footer: none, body)
`;

  out.push(template);
  if (coverPage) out.push(coverPage);
  out.push(`#fmpage[ #v(3.2in) #align(center, text(font: "EB Garamond 12", size: 22pt)[${esc(tp.t || pubName)}]) ]\n`);
  out.push(`#fmpage[ #v(2.5in) #align(center)[#text(font: "EB Garamond 12", size: 30pt)[${esc(tp.t || pubName)}] #v(0.35em) #text(size: 10pt, fill: faint)[${esc(tp.s)}] ${tp.a ? `#v(0.9in) #text(size: 10.5pt)[${esc(tp.a)}]` : ""}] ]\n`);
  out.push(`#fmpage[ #set par(first-line-indent: 0em, justify: false); #text(size: 9pt, tracking: 0.26em, fill: rubric)[ABOUT] #v(0.8em)\n${aboutBody} ]\n`);
  if (fm.dedication) out.push(`#fmpage[ #v(3in) #align(center, emph[${esc(textOf(fm.dedication).trim())}]) ]\n`);
  out.push(`#fmpage[ #text(size: 9pt, tracking: 0.26em, fill: rubric)[CONTENTS] #v(1em) #set text(size: 10pt); #set par(first-line-indent: 0em, justify: false); #context { for hd in query(heading.where(level: 1)) [ #box(width: 1fr, [#hd.body #box(width: 1fr, repeat[#h(3pt).#h(3pt)])]) #h(6pt) #counter(page).at(hd.location()).first() \\ ] } ]\n`);
  out.push(`#counter(page).update(1)\n`);
  let ai = 0;
  for (const s of sections) {
    if (s.part) { const k = textOf(find(s.part, x => has(x, "partkind")) || {}).trim(), t = textOf(find(s.part, x => has(x, "parttitle")) || {}).trim(); out.push(`#partpage(${str(k)}, ${str(t)})\n`); }
    else out.push(article(s.article, ai++));
  }
  if (backNotes.length) {
    out.push(`#pagebreak(weak: true)\n#text(size: 9pt, tracking: 0.26em, fill: rubric)[NOTES]\n#v(0.8em)\n#set par(first-line-indent: 0em, justify: false)\n`);
    for (const b of backNotes) out.push(`#text(size: 9.5pt, weight: 600)[${esc(b.title)}]\n${b.blk}`);
  }
  if (fm.appendix) {
    out.push(`#pagebreak(weak: true)\n#text(size: 9pt, tracking: 0.26em, fill: rubric)[FROM THE COMMENTS]\n#v(0.8em)\n`);
    out.push(kids(fm.appendix).filter(k => isEl(k) && k.name !== "h3").map(block).join(""));
  }
  if (fm.getmore) out.push(`#pagebreak(weak: true)\n#set par(first-line-indent: 0em, justify: false)\n#text(size: 9pt, tracking: 0.26em, fill: rubric)[GET MORE]\n#v(0.8em)\n${getmore}`);
  return out.join("\n");
}
