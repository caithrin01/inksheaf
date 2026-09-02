#!/usr/bin/env node
// Fixtures for the edition window, the checker, and the calendar fallback. No network, no model.
import { strict as assert } from "node:assert";
import { editionWindow } from "../functions/lib/edition-window.js";
import { buildEditorInput, volumePages } from "../functions/lib/editor-input.js";
import { checkPlan } from "../functions/lib/plan-check.js";
import { calendarFallback } from "../functions/lib/editor.js";

let n = 0; const ok = (name, cond, extra = "") => { n++; if (!cond) { console.log("FAIL", name, extra); process.exitCode = 1; } else console.log("ok  ", name); };

/* ---------- window ---------- */
const sep1 = Date.parse("2026-09-01T12:00:00Z");
let w = editionWindow(sep1);
ok("window mid-quarter start: four completed quarters", w.quarters.map(q => q.label).join(",") === "Q3 2025,Q4 2025,Q1 2026,Q2 2026");
ok("window label spans two years", w.label === "2025–26" && w.span === "Jul 2025 – Jun 2026");
ok("halves named as halves", w.halves.map(h => h.label).join(",") === "H2 2025,H1 2026");
ok("twelve months", w.months.length === 12 && w.months[0].label === "Jul 2025" && w.months[11].label === "Jun 2026");
ok("quarter in progress is Q3 2026", w.inProgress.label === "Q3 2026");
w = editionWindow(Date.parse("2026-01-01T00:00:00Z"));
ok("1 January: window is the calendar year", w.quarters[0].label === "Q1 2025" && w.quarters[3].label === "Q4 2025" && w.label === "2025");
w = editionWindow(Date.parse("2026-03-31T23:59:59Z"));
ok("last second of a quarter: that quarter is still in progress", w.inProgress.label === "Q1 2026" && w.quarters[3].label === "Q4 2025");
w = editionWindow(Date.parse("2026-04-01T00:00:00Z"));
ok("first second of a quarter rolls the window", w.quarters[3].label === "Q1 2026");

/* ---------- fixtures ---------- */
let id = 100;
const mk = (date, words, extra = {}) => ({ id: id++, post_date: date + "T12:00:00Z", title: "Post " + id, wordcount: words, type: "newsletter", audience: "everyone",
  publishedBylines: [{ name: "Fixture Writer" }], body_html: extra.footnotes ? '<a class="footnote-anchor"></a>'.repeat(extra.footnotes) : "", ...extra });
// A full year: 6 posts a month of 1500 words -> each quarter about 18 posts, 108 pages
const year = [];
for (const m of ["2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05","2026-06"])
  for (let d = 1; d <= 6; d++) year.push(mk(`${m}-${String(d * 4).padStart(2, "0")}`, 1500));
const progress = [mk("2026-07-10", 1500), mk("2026-08-02", 1500)];
const identity = { publicationName: "Fixture" };
const input = buildEditorInput({ posts: [...year, ...progress], identity, host: "fixture.substack.com", nowMs: sep1 });
ok("input: 72 posts in window, 2 in progress", input.posts.length === 72 && input.in_progress_posts.length === 2);
ok("input: paid and podcast posts are not rows", buildEditorInput({ posts: [mk("2026-01-05", 900, { audience: "only_paid" }), mk("2026-01-06", 900, { type: "podcast" }), mk("2026-01-07", 900)], identity, host: "x", nowMs: sep1 }).posts.length === 1);

/* ---------- calendar fallback passes the checker ---------- */
const fb = checkPlan(calendarFallback(input), input);
ok("fallback: passes the checker", fb.ok, fb.errors.join("; "));
ok("fallback: half-years recommended for a 490-page year, quarterly and monthly offered", fb.plan.routes.find(r => r.recommended)?.cadence === "half" && fb.plan.routes.some(r => r.cadence === "quarterly") && fb.plan.routes.some(r => r.cadence === "monthly"), JSON.stringify(fb.plan.routes.map(r => [r.cadence, r.recommended, r.est_pages])));
ok("fallback: four quarter volumes with Q labels", fb.plan.routes.find(r => r.cadence === "quarterly").volumes.map(v => v.label).join(",") === "Q3 2025,Q4 2025,Q1 2026,Q2 2026");
ok("fallback: volume numbers derived", fb.plan.routes.every(r => r.volumes.every(v => v.est_pages >= 32 && typeof v.price.bw === "number")));
const small = buildEditorInput({ posts: year.slice(0, 20), identity, host: "s", nowMs: sep1 });
const fbs = checkPlan(calendarFallback(small), small);
ok("fallback: young archive is a single volume", fbs.ok && fbs.plan.routes.find(r => r.recommended)?.cadence === "single", fbs.errors.join("; "));

/* ---------- checker rules ---------- */
const good = () => structuredClone(fb.plan);
const strip = p => { for (const r of p.routes) { delete r.est_pages; delete r.price; for (const v of r.volumes) { delete v.posts; delete v.words; delete v.est_pages; delete v.price; delete v.from; delete v.to; } } return p; };
const Q = p => p.routes.find(r => r.cadence === "quarterly");
const run = mutate => { const p = strip(good()); mutate(p); return checkPlan(p, input); };
const has = (res, re) => !res.ok && res.errors.some(e => re.test(e));
ok("rule: a good plan passes", run(() => {}).ok);
ok("rule: a post bound nowhere", has(run(p => Q(p).volumes[0].post_ids.pop()), /bound nowhere/));
ok("rule: a post bound twice", has(run(p => Q(p).volumes[1].post_ids.push(Q(p).volumes[0].post_ids[0])), /bound twice/));
ok("rule: a post from the quarter in progress", has(run(p => Q(p).volumes[3].post_ids.push(progress[0].id)), /quarter in progress/));
ok("rule: a label not in the window", has(run(p => { Q(p).volumes[0].label = "Q1 2019"; }), /not from the window/));
ok("rule: a post dated outside its label", has(run(p => { const a = Q(p).volumes[0], b = Q(p).volumes[1]; const moved = b.post_ids.pop(); a.post_ids.push(moved); }), /outside/));
ok("rule: two recommended routes", (() => { const p = strip(structuredClone(fbs.plan)); p.routes.forEach(r => r.recommended = true); const r = checkPlan(p, small); return p.routes.length >= 2 && has(r, /exactly one recommended/); })(), "routes " + fbs.plan.routes.length);
ok("rule: contributor without a byline", has(run(p => p.contributors.push({ name: "Nobody", role: "guest", posts: 1 })), /no byline/));
ok("rule: excluded post must be in the window", has(run(p => p.excluded.push({ post_id: 9, reason: "x" })), /not in the window/));
ok("rule: excluding over 10% needs kind notes", has(run(p => { for (let i = 0; i < 9; i++) { const pid = Q(p).volumes[0].post_ids.pop(); p.excluded.push({ post_id: pid, reason: "housekeeping" }); } }), /over 10%/));
ok("rule: parts must cover the volume exactly", has(run(p => { Q(p).volumes[0].parts = [{ name: "A", post_ids: Q(p).volumes[0].post_ids.slice(0, 3) }]; }), /parts must cover/));
ok("rule: notes none with footnotes present", (() => { const posts = [mk("2025-08-05", 20000, { footnotes: 3 }), mk("2026-02-05", 20000)]; const inp = buildEditorInput({ posts, identity, host: "f", nowMs: sep1 }); const p = strip(calendarFallback(inp)); Q(p).volumes[0].notes_policy = "none"; return has(checkPlan(p, inp), /notes_policy none/); })());
ok("fallback: quarters that all split are ruled out and the months are offered", (() => { const big = buildEditorInput({ posts: [mk("2025-08-03", 1500), mk("2025-08-20", 1500), ...Array.from({ length: 12 }, (_, i) => mk(`2026-0${(i % 3) + 4}-${String(i + 1).padStart(2, "0")}`, 9000))], identity, host: "b", nowMs: sep1 }); const p = strip(calendarFallback(big)); const r = checkPlan(p, big); const m = r.plan.routes.find(x => x.cadence === "monthly"); const qi = p.infeasible.find(i => i.cadence === "quarterly"); return r.ok && qi && /fold or split/.test(qi.reason) && m && m.volumes.length >= 3 && m.volumes.every(v => v.est_pages <= 300); })());
ok("rule: a volume over the cap is refused", (() => { const big = buildEditorInput({ posts: [mk("2025-08-03", 1500), mk("2025-08-20", 1500), ...Array.from({ length: 12 }, (_, i) => mk(`2026-0${(i % 3) + 4}-${String(i + 1).padStart(2, "0")}`, 9000))], identity, host: "b", nowMs: sep1 }); const p = { ...strip(calendarFallback(big)) }; p.routes = [{ cadence: "quarterly", recommended: true, why: "x", volumes: [{ label: "Q3 2025", title: "t", subtitle: "s", post_ids: big.posts.filter(r => r.date < "2025-10-01").map(r => r.id), parts: null, notes_policy: "none", why: "w" }, { label: "Q2 2026", title: "t", subtitle: "s", post_ids: big.posts.filter(r => r.date >= "2026-04-01").map(r => r.id), parts: null, notes_policy: "none", why: "w" }] }]; p.infeasible = []; const r = checkPlan(p, big); return !r.ok && r.errors.some(e => /past the 300-page cap/.test(e)); })());
ok("rule: folded label of two adjacent quarters is accepted", (() => { const p = strip(good()); const q = p.routes.find(r => r.cadence === "quarterly"); const [a, b] = q.volumes.splice(0, 2); q.volumes.unshift({ ...a, label: "Q3 2025 – Q4 2025", post_ids: [...a.post_ids, ...b.post_ids] }); return checkPlan(p, input).ok; })());

/* younger than a quarter: everything so far is the window */
{
  const young4 = buildEditorInput({ posts: [mk("2026-08-07", 1400), mk("2026-08-14", 1500), mk("2026-08-21", 1300), mk("2026-08-28", 1500)], identity, host: "y", nowMs: sep1 });
  const fy = checkPlan(calendarFallback(young4), young4);
  ok("younger than a quarter: window is everything so far", young4.window.label === "Everything so far" && young4.posts.length === 4 && young4.in_progress_posts.length === 0, young4.window.label);
  ok("younger than a quarter: one book, checker passes", fy.ok && fy.plan.routes.length === 1 && fy.plan.routes[0].cadence === "single" && /Everything so far/.test(fy.plan.sentences.plan_headline), fy.errors.join("; "));
}
console.log(`plan-check: ${n} checks, ${process.exitCode ? "FAIL" : "all pass"}`);
