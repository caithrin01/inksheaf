// Shapes an archive into the editor's input: compact rows the model can read, plus the
// window, the constraints and the price table. Nothing here calls a model.
import { editionWindow, spanLabel as spanLabelOf } from "./edition-window.js";
import { ruleCut } from "./cuts.js";
import prices from "./print-prices.json" with { type: "json" };

export const PAGE_WORDS = 270;
export const MIN_PAGES = 32, MAX_PAGES = 300, HARD_MAX = 800;
export const KIND_HINTS = "essays, letters (date-titled dispatches), recipes, poems, stories, reviews, dispatches, serial (one continuing work), notes (short posts), mixed";

export function rawPages(posts) {
  const words = posts.reduce((s, p) => s + (Number(p.wordcount) || 0), 0);
  return Math.round(words / PAGE_WORDS + posts.length + 8);
}
export function volumePages(posts) { return Math.max(MIN_PAGES, rawPages(posts)); }
export function printCost(pages, interior = "bw") {
  const pod = prices.pods[interior] || prices.pods.bw;
  return Math.round((pod.base + pod.per_page * pages) * 100) / 100;
}

const count = (html, re) => (String(html || "").match(re) || []).length;

/* A post's identity: the archive's id, or a stable hash of its slug when a slimmed relay
   record has none. The build step re-reads the archive and maps back the same way. */
export function postId(p) {
  const n = Number(p && p.id);
  if (Number.isFinite(n) && n > 0) return n;
  const key = String((p && (p.slug || p.canonical_url || p.title)) || "");
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h || 1;
}

/* One compact row per post. ids are the archive's own post ids. */
export function shapePost(p) {
  const body = p.body_html || "";
  return {
    id: postId(p),
    date: String(p.post_date || "").slice(0, 10),
    title: String(p.title || "").slice(0, 140),
    subtitle: String(p.subtitle || p.description || "").slice(0, 160),
    words: Number(p.wordcount) || 0,
    by: (p.publishedBylines || []).map(b => b?.name).filter(Boolean).slice(0, 4),
    section: p.section_name || null,
    tags: (p.postTags || []).map(t => t?.name || t).filter(Boolean).slice(0, 5),
    audience: p.audience || "everyone",
    type: p.type || "newsletter",
    image: !!p.cover_image,
    images: p.images != null ? Number(p.images) || 0 : count(body, /<img\b/gi),
    footnotes: p.footnotes != null ? Number(p.footnotes) || 0 : count(body, /class="footnote-anchor"/gi),
    links: p.links != null ? Number(p.links) || 0 : count(body, /<a\b[^>]*href="https?:/gi),
    excerpt: String(p.truncated_body_text || "").replace(/\s+/g, " ").slice(0, 200),
  };
}

/* Split posts into the window, the quarter in progress, and older. Public newsletters only. */
export function partition(posts, nowMs, host = "") {
  const w = editionWindow(nowMs);
  const inWindow = [], inProgress = [], older = [], paid = [], podcasts = [], cut = [];
  const seen = new Set();
  for (const p of posts) {
    if (!p || !p.post_date) continue;
    /* archive pages can overlap when Substack's listing shifts mid-read; one record per post */
    const key = postId(p); if (seen.has(key)) continue; seen.add(key);
    const d = String(p.post_date).slice(0, 10);
    if (p.type === "podcast") { podcasts.push(p); continue; }
    /* cuts by rule (functions/lib/cuts.js): cross-posts, threads, tagged housekeeping; each with
       its reason, so the plan and the change page can name what the editor never saw */
    const why = ruleCut(p, host);
    if (why) { cut.push({ post: p, reason: why }); continue; }
    if (p.audience && p.audience !== "everyone") { paid.push(p); continue; }
    if (d >= w.fromIso && d < w.toIso) inWindow.push(p);
    else if (d >= w.toIso) inProgress.push(p);
    else older.push(p);
  }
  return { window: w, inWindow, inProgress, older, paid, podcasts, cut };
}

export function buildEditorInput({ posts, identity, host, nowMs, capped }) {
  const part = partition(posts, nowMs, host);
  /* A publication younger than a quarter has nothing in the completed quarters. Its edition
     is everything so far: launch to today, one window, no periods, nothing "in progress". */
  if (!part.inWindow.length && part.inProgress.length) {
    const sorted = [...part.inProgress].sort((a, b) => Date.parse(a.post_date) - Date.parse(b.post_date));
    const first = new Date(String(sorted[0].post_date)), today = new Date(nowMs + 864e5);
    const from = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
    part.window = { ...part.window, fromIso: from.toISOString().slice(0, 10), toIso: today.toISOString().slice(0, 10), label: "Everything so far",
      span: spanLabelOf(from, today), quarters: [], halves: [], months: [], inProgress: { label: part.window.inProgress.label, fromIso: today.toISOString().slice(0, 10), toIso: today.toISOString().slice(0, 10), span: "", everythingSoFar: true }, everythingSoFar: true };
    part.inWindow = sorted; part.inProgress = [];
  }
  const w = part.window;
  let rows = part.inWindow.map(shapePost).sort((a, b) => a.date.localeCompare(b.date));
  /* over 150 posts the model plans by period, so rows shrink to what a period decision needs
     and the model is told to name periods rather than list ids (the 524 on HCR, 2026-09-02) */
  const compact = rows.length > 150;
  if (compact) rows = rows.map(r => ({ id: r.id, date: r.date, title: r.title.slice(0, 70), words: r.words, by: r.by, section: r.section, footnotes: r.footnotes, images: r.images }));
  const months = {};
  for (const r of rows) { const k = r.date.slice(0, 7); const m = months[k] || (months[k] = { month: k, posts: 0, words: 0, footnotes: 0, images: 0, bylines: {} }); m.posts++; m.words += r.words; m.footnotes += r.footnotes || 0; m.images += r.images || 0; for (const b of r.by || []) m.bylines[b] = (m.bylines[b] || 0) + 1; }
  const by_month = Object.values(months).map(m => ({ ...m, est_pages: Math.round(m.words / PAGE_WORDS + m.posts + 8), bylines: Object.entries(m.bylines).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, c]) => `${n} ${c}`) }));
  const progress = part.inProgress.map(shapePost);
  const totalPages = volumePages(part.inWindow);
  const periods = {
    single: [{ label: w.label, span: w.span }],
    half: w.halves.map(h => ({ label: h.label, span: h.span })),
    quarterly: w.quarters.map(q => ({ label: q.label, span: q.span })),
    monthly: w.months.map(m => ({ label: m.label })),
  };
  return {
    publication: { host, name: identity?.publicationName || host, about: identity?.about || null,
      paid_posts_in_window: part.paid.filter(p => { const d = String(p.post_date).slice(0, 10); return d >= w.fromIso && d < w.toIso; }).length,
      podcasts_in_window: part.podcasts.length, cut_by_rule: part.cut.map(c => ({ id: postId(c.post), title: String(c.post.title || "").slice(0, 80), reason: c.reason })).slice(0, 40), read_capped: !!capped },
    window: { label: w.label, span: w.span, from: w.fromIso, to: w.toIso, periods,
      in_progress: { label: w.inProgress.label, span: w.inProgress.span, posts: progress.length } },
    totals: { posts: rows.length, words: rows.reduce((s, r) => s + r.words, 0), estimated_pages: totalPages },
    compact, by_month,
    constraints: { pages_formula: `pages = words/${PAGE_WORDS} + posts + 8, floor ${MIN_PAGES}`, min_pages: MIN_PAGES, max_pages: MAX_PAGES, hard_max: HARD_MAX,
      print_cost: { bw: `$${prices.pods.bw.base} + $${prices.pods.bw.per_page}/page`, color: `$${prices.pods.color.base} + $${prices.pods.color.per_page}/page` } },
    posts: rows,
    in_progress_posts: progress,
    _partition: part,
  };
}
