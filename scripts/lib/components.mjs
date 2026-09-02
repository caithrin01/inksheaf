// Substack blocks by their own name. Every editor block in body_html carries a
// data-component-name; this pass runs before the regex cleaners in build-book.mjs and decides,
// per block, what print gets: nothing (subscribe widgets, buttons, polls, comment placeholders,
// native video), a printable substitute (a tweet becomes a set quotation, an embedded post a
// citation line, a YouTube block a "Video:" line, a Datawrapper chart its static image, a
// LaTeX block its source in a math span, a mention its name), or the block untouched.
// Field names and markup from research-formatting.md part 2 (live API reads, 2026-09-02).
import { parseDocument } from "htmlparser2";
import render from "dom-serializer";

const isEl = n => n && n.type === "tag";
const attr = (n, a) => (isEl(n) && n.attribs && n.attribs[a]) || "";
const cls = n => (attr(n, "class") || "").split(/\s+/);
const has = (n, c) => cls(n).includes(c);
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const data = n => { try { return JSON.parse(attr(n, "data-attrs") || "{}"); } catch { return {}; } };
const textEl = (tag, inner, klass) => ({ type: "tag", name: tag, attribs: klass ? { class: klass } : {}, children: [{ type: "text", data: inner }] });
const htmlEl = html => parseDocument(html).children;

/* what each named block becomes; null removes it, undefined leaves it alone */
const RULES = {
  SubscribeWidgetToDOM: () => null,
  ButtonCreateButton: () => null,
  CommentPlaceholder: () => null,
  PollToDOM: () => null,
  VideoPlaceholder: () => null,
  EmbeddedPublicationToDOMWithSubscribe: n => { const d = data(n); return d.name ? htmlEl(`<div class="embedcard">${esc(d.name)}${d.base_url ? ` · ${esc(String(d.base_url).replace(/^https?:\/\//, ""))}` : ""}</div>`) : null; },
  Twitter2ToDOM: n => { const d = data(n); if (!d.full_text) return null;
    const who = [d.name, d.username ? "@" + d.username : ""].filter(Boolean).join(" ");
    return htmlEl(`<blockquote class="tweet-print"><p>${esc(d.full_text).replace(/\n+/g, "<br>")}</p><p class="tweet-by">— ${esc(who)}${d.date ? ", " + esc(String(d.date).slice(0, 10)) : ""}, on X</p></blockquote>`); },
  Youtube2ToDOM: n => { const d = data(n); return d.videoId ? htmlEl(`<div class="embedcard">Video: youtu.be/${esc(d.videoId)}</div>`) : null; },
  LatexBlockToDOM: n => { const d = data(n); return d.persistentExpression ? htmlEl(`<p class="latex-print"><code>${esc(d.persistentExpression)}</code></p>`) : null; },
  HighlightedCodeBlockToDOM: undefined,
  Image2ToDOM: undefined,
  FootnoteAnchorToDOM: undefined,
  FootnoteToDOM: undefined,
};
/* blocks named by class rather than component, from the same research */
const CLASS_RULES = [
  ["embedded-post-wrap", n => { const d = data(n); const title = d.title || "", pub = d.publication_name || "", url = String(d.url || "").replace(/^https?:\/\//, "").split("?")[0];
    return htmlEl(`<div class="embedcard">${esc(pub ? pub + ": " : "")}${esc(title)}${url ? ` · ${esc(url)}` : ""}</div>`); }],
  ["digest-post-embed", n => { const d = data(n); const url = String(d.canonical_url || "").replace(/^https?:\/\//, "").split("?")[0]; return htmlEl(`<div class="embedcard">${esc(d.title || "")}${url ? ` · ${esc(url)}` : ""}</div>`); }],
  ["datawrapper-wrap", n => { const d = data(n); return d.thumbnail_url_full ? htmlEl(`<figure><img src="${esc(d.thumbnail_url_full)}" alt="${esc(d.title || "chart")}"></figure>`) : null; }],
  ["polymarket-embed", () => htmlEl(`<div class="embedcard">A live market, viewable in the online edition.</div>`)],
  ["mention-wrap", n => { const d = data(n); return d.name ? [textEl("span", d.name)] : null; }],
  ["image-gallery-embed", n => { const d = data(n); const imgs = (d.gallery && d.gallery.images) || []; return imgs.length ? htmlEl(imgs.map(i => `<figure><img src="${esc(i.src)}" alt=""></figure>`).join("")) : null; }],
  ["file-embed-wrapper", n => { const a = find(n, k => isEl(k) && k.name === "a"); const name = a ? textOf(a).trim() : "attachment"; const href = a ? String(attr(a, "href")).replace(/^https?:\/\//, "") : ""; return htmlEl(`<div class="embedcard">Attachment: ${esc(name)}${href ? ` · ${esc(href)}` : ""}</div>`); }],
  ["instagram-embed-wrap", () => htmlEl(`<div class="embedcard">An Instagram post, viewable in the online edition.</div>`)],
  ["subscription-widget-wrap-editor", () => null],
  ["image-link-expand", () => null],
];
const textOf = n => n.type === "text" ? n.data : isEl(n) ? (n.children || []).map(textOf).join("") : "";
function find(n, pred) { if (pred(n)) return n; for (const k of (n.children || [])) { const r = find(k, pred); if (r) return r; } return null; }

export function transformComponents(html, report = {}) {
  const doc = parseDocument(html);
  const seen = report.components = report.components || {};
  const walk = parent => {
    const out = [];
    for (const n of parent.children || []) {
      if (isEl(n)) {
        const name = attr(n, "data-component-name");
        let rule = name && Object.prototype.hasOwnProperty.call(RULES, name) ? RULES[name] : undefined;
        let key = name;
        if (rule === undefined) { const cr = CLASS_RULES.find(([c]) => has(n, c)); if (cr) { rule = cr[1]; key = cr[0]; } }
        if (name && !(name in RULES) && !CLASS_RULES.some(([c]) => has(n, c))) seen[name] = (seen[name] || 0) + 1; /* an unknown block: counted, left alone */
        if (rule !== undefined) {
          seen[key] = (seen[key] || 0) + 1;
          const rep = rule(n);
          if (rep === null) continue;
          if (Array.isArray(rep)) { for (const r of rep) { r.parent = parent; out.push(r); } continue; }
        }
        n.children = walk(n);
      }
      out.push(n);
    }
    return out;
  };
  doc.children = walk(doc);
  return render(doc, { encodeEntities: "utf8" }); /* keep the writer's characters as characters */
}
