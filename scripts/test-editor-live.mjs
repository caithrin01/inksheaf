#!/usr/bin/env node
// Editor eval: runs the editor on synthetic edge-case archives and on random live
// publications, checks every plan, and renders one HTML index of planning pages for
// Caithrin's read. Needs ANTHROPIC_API_KEY. Writes evidence to the vault.
// Usage: node scripts/test-editor-live.mjs [--random=30] [--seed=N] [--hosts=a.com,b.com] [--no-fixtures]
import { mkdirSync, writeFileSync } from "node:fs";
import { drawSample, readArchive } from "./lib/draw-substacks.mjs";
import { planEdition } from "../functions/lib/editor.js";
import { editionWindow } from "../functions/lib/edition-window.js";

const flag = (k, d) => { const m = process.argv.find(a => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
const RANDOM = Number(flag("random", 0)), SEED = Number(flag("seed", Math.floor(Date.now() / 60000)));
const HOSTS = (flag("hosts", "") || "").split(",").filter(Boolean);
const FIXTURES = !process.argv.includes("--no-fixtures");
const VAULT = process.env.VAULT || `${process.env.HOME}/Library/Mobile Documents/com~apple~CloudDocs/Caithrin/05-Projects/Substack Magazine/evidence/planner`;
const NOW = Date.now();
const w = editionWindow(NOW);
if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY is not set; the editor would fall back to the calendar for every row."); process.exit(2); }

/* ---------- synthetic edge cases ---------- */
let nextId = 5000;
const mk = (date, words, o = {}) => ({ id: nextId++, post_date: `${date}T12:00:00Z`, title: o.title || `Post of ${date}`, subtitle: o.subtitle || "", wordcount: words,
  type: o.type || "newsletter", audience: o.audience || "everyone", publishedBylines: [{ name: o.by || "Ada Fixture" }], section_name: o.section || null,
  postTags: (o.tags || []).map(name => ({ name })), cover_image: o.image ? "https://x/img.jpg" : null,
  body_html: `${'<img src="x">'.repeat(o.images || 0)}${'<a class="footnote-anchor"></a>'.repeat(o.footnotes || 0)}${'<a href="https://x">l</a>'.repeat(o.links || 0)}`,
  truncated_body_text: o.excerpt || "" });
const q = w.quarters, months = w.months.map(m => m.fromIso.slice(0, 7));
const spread = (n, words, o = {}) => months.flatMap(m => Array.from({ length: n }, (_, i) => mk(`${m}-${String(2 + i * 4).padStart(2, "0")}`, words, o)));
const fixtures = [
  { name: "steady weekly essays, footnoted", posts: spread(4, 1800, { footnotes: 4, links: 6 }) },
  { name: "young publication, five months", posts: months.slice(7).flatMap(m => [mk(`${m}-03`, 1400), mk(`${m}-17`, 1400)]) },
  { name: "hiatus: nothing Oct to Feb", posts: months.filter(m => !["-10","-11","-12","-01","-02"].some(s => m.endsWith(s))).flatMap(m => Array.from({ length: 5 }, (_, i) => mk(`${m}-${String(3 + i * 5).padStart(2, "0")}`, 1600))) },
  { name: "daily letters, one month over 300 pages", posts: [...spread(3, 900, { title: "" }), ...Array.from({ length: 30 }, (_, i) => mk(`${months[3]}-${String(i + 1).padStart(2, "0")}`, 3200, { title: `${months[3]}-${String(i + 1).padStart(2, "0")}` }))].map(p => ({ ...p, title: p.title || new Date(p.post_date).toDateString() })) },
  { name: "thin quarter beside fat ones", posts: [...months.slice(0, 3).map(m => mk(`${m}-10`, 500)), ...months.slice(3).flatMap(m => Array.from({ length: 6 }, (_, i) => mk(`${m}-${String(2 + i * 4).padStart(2, "0")}`, 1700)))] },
  { name: "two co-equal authors with guests", posts: spread(3, 1500).map((p, i) => ({ ...p, publishedBylines: [{ name: i % 7 === 6 ? "Guest Writer" : i % 2 ? "Ada Fixture" : "Bo Fixture" }] })) },
  { name: "recipes with photos", posts: spread(3, 900, { images: 6, image: true, tags: ["recipes"], section: "Recipes" }) },
  { name: "housekeeping and pitches mixed in", posts: [...spread(3, 1600), ...months.map(m => mk(`${m}-28`, 120, { title: "Housekeeping: subscribe, share, open thread" }))] },
  { name: "a serial in named parts", posts: spread(2, 2500).map((p, i) => ({ ...p, title: `Chapter ${i + 1}`, section_name: i < 12 ? "Book One" : "Book Two" })) },
  { name: "mixed: essays, a podcast feed and paid posts", posts: [...spread(2, 1500), ...months.map(m => mk(`${m}-15`, 300, { type: "podcast" })), ...months.map(m => mk(`${m}-20`, 1500, { audience: "only_paid" }))] },
];

/* ---------- run ---------- */
const rows = [];
async function runOne(name, host, posts, identity) {
  const t0 = Date.now();
  let r;
  try { r = await planEdition({ posts, identity, host, nowMs: NOW, log: (k, m) => console.log("   ", k, m) }); }
  catch (e) { r = { planned_by: "error", errors: [String(e.message || e)], plan: null }; }
  const ms = Date.now() - t0;
  const rec = r.plan?.routes?.find(x => x.recommended);
  console.log(`${r.planned_by === "editor" ? "PLAN " : "FALL "} ${name.padEnd(44)} ${String(ms).padStart(6)}ms  ${rec ? rec.cadence + " " + rec.volumes.map(v => v.label + " " + v.est_pages + "pp").join(", ") : "-"}  ${r.errors?.length ? "errors: " + r.errors[0] : ""}`);
  rows.push({ name, host, ms, ...r, posts_in_window: r.totals?.posts });
}
if (FIXTURES) for (const f of fixtures) await runOne(f.name, `${f.name.replace(/\W+/g, "-").toLowerCase()}.fixture`, f.posts, { publicationName: f.name });
const live = [...HOSTS.map(host => ({ host, name: host })), ...(RANDOM ? await drawSample(RANDOM, SEED) : [])];
for (const pub of live) {
  let posts;
  try { posts = await readArchive(pub.host, { untilIso: w.fromIso }); } catch (e) { console.log("SKIP ", pub.host, e.message); rows.push({ name: pub.name, host: pub.host, planned_by: "unread", errors: [e.message] }); continue; }
  await runOne(pub.name || pub.host, pub.host, posts, { publicationName: pub.name });
}

/* ---------- evidence ---------- */
mkdirSync(VAULT, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const card = v => `<div class="vol"><b>${esc(v.label)}</b><div>${esc(v.subtitle)}</div><div>${v.posts} posts · ${v.est_pages}pp · $${v.price?.bw} bw / $${v.price?.color} colour</div><div class="why">${esc(v.why)}</div>${v.parts ? `<div class="parts">${v.parts.map(p => esc(p.name) + " (" + p.post_ids.length + ")").join(" · ")}</div>` : ""}<div class="notes">notes: ${esc(v.notes_policy)}</div></div>`;
const page = r => !r.plan ? `<p class="bad">${esc(r.planned_by)}: ${esc(r.errors?.[0])}</p>` : `
  <p class="meta">${r.planned_by === "editor" ? "planned by the editor" : "<span class=bad>calendar fallback: " + esc(r.reason) + "</span>"} · ${r.attempts || 0} attempt(s) · ${r.ms} ms · ${r.usage ? r.usage.input + " in / " + r.usage.output + " out" : ""} · ${r.posts_in_window} posts in window</p>
  <p class="kind">${esc(r.plan.kind)} · ${esc(r.plan.rhythm)}</p><p>${esc(r.plan.description)}</p>
  <h3>${esc(r.plan.sentences.plan_headline)}</h3><p>${esc(r.plan.sentences.plan_sub)}</p>
  ${r.plan.routes.map(rt => `<div class="route ${rt.recommended ? "rec" : ""}"><h4>${rt.recommended ? "Golden route: " : ""}${esc(rt.cadence)} · ${rt.est_pages}pp · $${rt.price?.bw}</h4><p>${esc(rt.why)}</p><div class="vols">${rt.volumes.map(card).join("")}</div></div>`).join("")}
  ${r.plan.infeasible.length ? `<p class="inf">Not offered: ${r.plan.infeasible.map(i => esc(i.cadence) + " (" + esc(i.reason) + ")").join("; ")}</p>` : ""}
  <p>Interior: <b>${esc(r.plan.interior.recommended)}</b>. ${esc(r.plan.interior.why)}</p>
  <p>Contributors: ${r.plan.contributors.map(c => esc(c.name) + " (" + c.role + ", " + c.posts + ")").join(", ")}</p>
  ${r.plan.excluded.length ? `<p>Excluded: ${r.plan.excluded.map(e => e.post_id + " " + esc(e.reason)).join("; ")}</p>` : ""}
  <p>In progress: ${esc(r.window?.in_progress?.label)}, ${r.window?.in_progress?.posts} posts. Proof email opens: “${esc(r.plan.sentences.proof_email_opening)}”</p>
  ${r.errors?.length ? `<p class="bad">Checker: ${r.errors.map(esc).join("; ")}</p>` : ""}`;
const html = `<!doctype html><meta charset="utf-8"><title>Editor eval ${stamp}</title><style>body{font:15px/1.45 Georgia,serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#16120e;background:#f4efe6}section{border-top:2px solid #7d6448;padding:1rem 0 2rem}h2{margin:.2rem 0}.meta,.kind{color:#7d6448;font-size:13px}.route{margin:.6rem 0;padding:.6rem;border:1px solid #d8cdb8}.route.rec{border:2px solid #7d6448;background:#efe6d3}.vols{display:flex;flex-wrap:wrap;gap:.5rem}.vol{border:1px solid #b9a98c;padding:.4rem .6rem;min-width:180px;font-size:13px}.why,.notes,.parts{color:#5a4a36}.bad{color:#8a1c1c}.inf{font-style:italic}</style>
<h1>Editor eval, ${stamp}</h1><p>Window ${esc(w.span)} (${esc(w.label)}); in progress ${esc(w.inProgress.label)}. ${rows.length} rows: ${rows.filter(r => r.planned_by === "editor").length} planned by the editor, ${rows.filter(r => r.planned_by === "calendar").length} calendar fallbacks, ${rows.filter(r => !["editor","calendar"].includes(r.planned_by)).length} unread or errored. Seed ${SEED}.</p>
${rows.map(r => `<section><h2>${esc(r.name)}</h2><p class="meta">${esc(r.host)}</p>${page(r)}</section>`).join("")}`;
const base = `${VAULT}/${stamp}-seed${SEED}`;
writeFileSync(`${base}.html`, html);
writeFileSync(`${base}.json`, JSON.stringify(rows.map(({ plan, ...r }) => ({ ...r, plan })), null, 1));
const bad = rows.filter(r => r.planned_by !== "editor");
console.log(`\nEDITOR EVAL: ${rows.length} rows, ${rows.length - bad.length} planned by the editor, ${bad.length} not (${bad.map(b => b.planned_by).join(", ") || "none"}); index ${base}.html`);
console.log("not covered:\n  - publications not in the category listings\n  - paid-only archives\n  - the rendered book itself (phase 3): this judges the plan, not the pages\n  - a second run on the same publication (determinism is measured in phase 5)");
process.exitCode = bad.length ? 1 : 0;
