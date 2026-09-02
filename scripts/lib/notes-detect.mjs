// Finds a source-notes block written into a post's body: the trailing part of the post that
// reads as citations rather than prose, whatever it is called. Three signals, in order:
//   1. structure: the tail after the last heading (or last rule) scores on links per paragraph,
//      citation shapes ("Label — text", "Author, Title (Year)", "- " bullets, publisher and
//      date tokens), short paragraphs, and few sentences of prose;
//   2. the heading's own words (sources, notes, references, further reading, citations, works
//      cited, bibliography, in any case, with any parenthetical), which alone are enough;
//   3. a model, for tails that score in the ambiguous band, asked one yes-or-no question with
//      the heading and the first lines (OpenRouter, cheap text model, cached per post).
// Result: { start, heading, score, method } or null. Caithrin's 8 of 23 posts (2026-09-02) are
// the reference; test: scripts/test-notes-detect.mjs.
const HEAD = /^(?:sources?|notes?|end ?notes?|footnotes?|references?|citations?|works cited|bibliography|further reading|reading list|sources?\s*(?:&|&amp;|and|\/)\s*notes?|notes?\s*(?:&|&amp;|and|\/)\s*sources?|links?|appendix(?:\s*[a-z0-9])?)\s*(?:[:.]|\([^)]*\))?\s*$/i;

export function scoreTail(tailHtml) {
  const paras = tailHtml.split(/<\/p>|<\/li>/).map(x => x.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter(x => x.length > 2);
  if (!paras.length) return { score: 0, paras: 0 };
  const links = (tailHtml.match(/<a\s[^>]*href=/gi) || []).length + (tailHtml.match(/https?:\/\/\S+/g) || []).length;
  const dashed = paras.filter(x => /^.{2,90}?\s[—–]\s/.test(x)).length;
  const bullets = paras.filter(x => /^[-–•]\s/.test(x)).length + (tailHtml.match(/<li>/gi) || []).length;
  const cite = paras.filter(x => /\(\d{4}\)|\b(19|20)\d{2}\b.*\b(pp?\.|vol\.|no\.|ed\.)|\bet al\.|\b(Press|Journal|Review|Report|Working Paper|Bulletin|Times|Post|Bloomberg|Reuters|CNN|BBC|NPR|arXiv|doi\.org|substack\.com|wikipedia)\b/i.test(x)).length;
  const sentences = paras.reduce((n, x) => n + (x.match(/[.!?](\s|$)/g) || []).length, 0);
  const avg = paras.reduce((n, x) => n + x.length, 0) / paras.length;
  const linkRate = links / paras.length, dashRate = dashed / paras.length, bulletRate = Math.min(1, bullets / paras.length), citeRate = cite / paras.length;
  const proseRate = Math.min(1, sentences / paras.length / 3); /* three sentences a paragraph is prose */
  const score = Math.min(1, 0.35 * Math.min(1, linkRate) + 0.25 * dashRate + 0.2 * bulletRate + 0.25 * citeRate + 0.1 * (avg < 260 ? 1 : 0) - 0.3 * proseRate);
  return { score: Math.round(score * 100) / 100, paras: paras.length, links, dashed, bullets, cite };
}

export function detectNotes(html) {
  const heads = [...html.matchAll(/<(h[2-4])[^>]*>([\s\S]*?)<\/\1>/gi)];
  const last = heads[heads.length - 1];
  const hrIdx = html.lastIndexOf("<hr");
  let start = -1, heading = "";
  if (last) { start = last.index; heading = last[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim(); }
  if (hrIdx > start) { const after = html.slice(hrIdx); if (!/<h[2-4]/i.test(after)) { start = hrIdx; heading = heading && last.index > hrIdx ? heading : ""; } }
  if (start < 0) return null;
  const tail = html.slice(start).replace(/^<(h[2-4])[^>]*>[\s\S]*?<\/\1>/i, "").replace(/^<hr[^>]*>/i, "");
  const s = scoreTail(tail);
  if (s.paras < 1) return null;
  const headHit = HEAD.test(heading);
  if (headHit && s.score >= 0.15) return { start, heading, score: s.score, method: "heading", ...s };
  if (s.score >= 0.55 && s.paras >= 3) return { start, heading, score: s.score, method: "structure", ...s };
  if (s.score >= 0.3 && s.paras >= 3) return { start, heading, score: s.score, method: "ambiguous", ...s }; /* the caller may ask the model */
  return null;
}

/* the model's one question, for the ambiguous band; answers true, false, or null when no key */
export async function askModel(heading, tailHtml, { key = process.env.OPENROUTER_API_KEY, model = process.env.NOTES_MODEL || "google/gemini-3.1-flash-lite" } = {}) {
  if (!key) return null;
  const text = tailHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1500);
  const body = { model, max_tokens: 5, temperature: 0, messages: [{ role: "user", content:
    `A blog post ends with a section headed "${heading || "(no heading)"}". Here is how it begins:\n\n${text}\n\nIs this section a list of sources, notes, references or citations for the essay above it, rather than part of the essay's prose? Answer yes or no.` }] };
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json(); const a = (j.choices?.[0]?.message?.content || "").trim().toLowerCase();
    return a.startsWith("y") ? true : a.startsWith("n") ? false : null;
  } catch { return null; }
}
