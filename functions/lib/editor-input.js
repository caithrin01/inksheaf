// Shapes an archive into the editor's input: compact rows the model can read, plus the
// window, the constraints and the price table. Nothing here calls a model.
import { editionWindow } from "./edition-window.js";
import prices from "./print-prices.json" with { type: "json" };

export const PAGE_WORDS = 270;
export const MIN_PAGES = 32, MAX_PAGES = 300, HARD_MAX = 800;
export const KIND_HINTS = "essays, letters (date-titled dispatches), recipes, poems, stories, reviews, dispatches, serial (one continuing work), notes (short posts), mixed";

export function volumePages(posts) {
  const words = posts.reduce((s, p) => s + (Number(p.wordcount) || 0), 0);
  return Math.max(MIN_PAGES, Math.round(words / PAGE_WORDS + posts.length + 8));
}
export function printCost(pages, interior = "bw") {
  const pod = prices.pods[interior] || prices.pods.bw;
  return Math.round((pod.base + pod.per_page * pages) * 100) / 100;
}

const count = (html, re) => (String(html || "").match(re) || []).length;

/* One compact row per post. ids are the archive's own post ids. */
export function shapePost(p) {
  const body = p.body_html || "";
  return {
    id: Number(p.id),
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
    images: count(body, /<img\b/gi),
    footnotes: count(body, /class="footnote-anchor"/gi),
    links: count(body, /<a\b[^>]*href="https?:/gi),
    excerpt: String(p.truncated_body_text || "").replace(/\s+/g, " ").slice(0, 200),
  };
}

/* Split posts into the window, the quarter in progress, and older. Public newsletters only. */
export function partition(posts, nowMs) {
  const w = editionWindow(nowMs);
  const inWindow = [], inProgress = [], older = [], paid = [], podcasts = [];
  for (const p of posts) {
    if (!p || !p.post_date) continue;
    const d = String(p.post_date).slice(0, 10);
    if (p.type === "podcast") { podcasts.push(p); continue; }
    if (p.type && p.type !== "newsletter") continue;
    if (p.audience && p.audience !== "everyone") { paid.push(p); continue; }
    if (d >= w.fromIso && d < w.toIso) inWindow.push(p);
    else if (d >= w.toIso) inProgress.push(p);
    else older.push(p);
  }
  return { window: w, inWindow, inProgress, older, paid, podcasts };
}

export function buildEditorInput({ posts, identity, host, nowMs, capped }) {
  const part = partition(posts, nowMs);
  const w = part.window;
  const rows = part.inWindow.map(shapePost).sort((a, b) => a.date.localeCompare(b.date));
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
      podcasts_in_window: part.podcasts.length, read_capped: !!capped },
    window: { label: w.label, span: w.span, from: w.fromIso, to: w.toIso, periods,
      in_progress: { label: w.inProgress.label, span: w.inProgress.span, posts: progress.length } },
    totals: { posts: rows.length, words: rows.reduce((s, r) => s + r.words, 0), estimated_pages: totalPages },
    constraints: { pages_formula: `pages = words/${PAGE_WORDS} + posts + 8, floor ${MIN_PAGES}`, min_pages: MIN_PAGES, max_pages: MAX_PAGES, hard_max: HARD_MAX,
      print_cost: { bw: `$${prices.pods.bw.base} + $${prices.pods.bw.per_page}/page`, color: `$${prices.pods.color.base} + $${prices.pods.color.per_page}/page` } },
    posts: rows,
    in_progress_posts: progress,
    _partition: part,
  };
}
