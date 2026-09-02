// The checker: every invariant an editorial plan must satisfy, plus the derived numbers
// (posts, words, pages, price) per volume. The model proposes; this decides.
import { EditorialPlan } from "./editor-schema.js";
import { volumePages, rawPages, printCost, postId, MIN_PAGES, MAX_PAGES, HARD_MAX } from "./editor-input.js";

const labelsOf = (w, cadence) =>
  cadence === "quarterly" ? w.quarters.map(q => q.label)
  : cadence === "half" ? w.halves.map(h => h.label)
  : cadence === "monthly" ? w.months.map(m => m.label)
  : [w.label];
const boundsOf = (w, cadence, label) => {
  const list = cadence === "quarterly" ? w.quarters : cadence === "half" ? w.halves : cadence === "monthly" ? w.months : [{ label: w.label, fromIso: w.fromIso, toIso: w.toIso }];
  const parts = label.split(" – ").map(s => s.trim().replace(/\s·\s(?:[IVX]+|\d+)$/, ""));
  const found = parts.map(p => list.find(x => x.label === p)).filter(Boolean);
  if (found.length !== parts.length) return null;
  return { fromIso: found[0].fromIso, toIso: found[found.length - 1].toIso };
};

/* input: the object from buildEditorInput. raw: the model's parsed output. */
export function checkPlan(raw, input) {
  const errors = [];
  const parsed = EditorialPlan.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(i => `schema: ${i.path.join(".")} ${i.message}`) };
  const plan = structuredClone(parsed.data);
  const w = input._partition.window;
  const byId = new Map(input._partition.inWindow.map(p => [postId(p), p]));
  const rowById = new Map(input.posts.map(r => [r.id, r]));
  const progressIds = new Set(input._partition.inProgress.map(p => postId(p)));
  const excludedIds = new Set(plan.excluded.map(e => e.post_id));
  for (const e of plan.excluded) if (!byId.has(e.post_id)) errors.push(`excluded post ${e.post_id} is not in the window`);
  if (byId.size && plan.excluded.length > Math.max(1, byId.size * 0.1) && plan.kind !== "notes")
    errors.push(`excluded ${plan.excluded.length} of ${byId.size} posts; over 10% needs kind "notes"`);

  const rec = plan.routes.filter(r => r.recommended);
  if (plan.routes.length && rec.length !== 1) errors.push(`exactly one recommended route required, found ${rec.length}`);
  const seenCadence = new Set();
  for (const route of plan.routes) {
    if (seenCadence.has(route.cadence)) errors.push(`cadence ${route.cadence} appears twice`);
    seenCadence.add(route.cadence);
    const seen = new Set();
    if (!route.volumes.length) errors.push(`${route.cadence}: no volumes`);
    for (const v of route.volumes) {
      const b = boundsOf(w, route.cadence, v.label);
      if (!b) errors.push(`${route.cadence}: label "${v.label}" is not from the window's ${route.cadence} labels (${labelsOf(w, route.cadence).join(", ")})`);
      const posts = [];
      for (const id of v.post_ids) {
        if (seen.has(id)) errors.push(`${route.cadence} "${v.label}": post ${id} bound twice`);
        seen.add(id);
        if (progressIds.has(id)) { errors.push(`${route.cadence} "${v.label}": post ${id} is in the quarter in progress`); continue; }
        if (excludedIds.has(id)) { errors.push(`${route.cadence} "${v.label}": post ${id} is also excluded`); continue; }
        const p = byId.get(id);
        if (!p) { errors.push(`${route.cadence} "${v.label}": post ${id} is not a public post in the window`); continue; }
        const d = String(p.post_date).slice(0, 10);
        if (b && !(d >= b.fromIso && d < b.toIso)) errors.push(`${route.cadence} "${v.label}": post ${id} dated ${d} is outside ${b.fromIso}..${b.toIso}`);
        posts.push(p);
      }
      if (v.parts) {
        const partIds = v.parts.flatMap(x => x.post_ids);
        const set = new Set(v.post_ids);
        for (const id of partIds) if (!set.has(id)) errors.push(`${route.cadence} "${v.label}": part post ${id} is not in the volume`);
        if (new Set(partIds).size !== v.post_ids.length) errors.push(`${route.cadence} "${v.label}": parts must cover the volume exactly once`);
      }
      const pages = volumePages(posts);
      const words = posts.reduce((s, p) => s + (Number(p.wordcount) || 0), 0);
      if (pages > HARD_MAX) errors.push(`${route.cadence} "${v.label}": ${pages} pages is past the bindery's ${HARD_MAX}`);
      else if (pages > MAX_PAGES) errors.push(`${route.cadence} "${v.label}": ${pages} pages is past the ${MAX_PAGES}-page cap`);
      if (posts.length && rawPages(posts) < MIN_PAGES && route.volumes.length > 1) errors.push(`${route.cadence} "${v.label}": under ${MIN_PAGES} pages`);
      const notes = posts.reduce((s, p) => s + (rowById.get(postId(p))?.footnotes || 0), 0);
      if (v.notes_policy === "none" && notes > 0) errors.push(`${route.cadence} "${v.label}": notes_policy none but ${notes} footnotes exist`);
      Object.assign(v, { posts: posts.length, words, est_pages: pages,
        price: { bw: printCost(pages, "bw"), color: printCost(pages, "color") }, from: posts[0] ? String(posts[0].post_date).slice(0, 10) : null,
        to: posts.length ? String(posts[posts.length - 1].post_date).slice(0, 10) : null });
    }
    for (const id of byId.keys()) if (!seen.has(id) && !excludedIds.has(id)) errors.push(`${route.cadence}: post ${id} is bound nowhere and not excluded`);
    if (route.volumes.length < 2 && route.cadence !== "single") errors.push(`${route.cadence}: fewer than two volumes; should be listed as infeasible`);
    route.est_pages = route.volumes.reduce((s, v) => s + (v.est_pages || 0), 0);
    route.price = { bw: Math.round(route.volumes.reduce((s, v) => s + v.price.bw, 0) * 100) / 100,
      color: Math.round(route.volumes.reduce((s, v) => s + v.price.color, 0) * 100) / 100 };
  }
  const bylines = new Set(input.posts.flatMap(r => r.by));
  for (const c of plan.contributors) if (!bylines.has(c.name)) errors.push(`contributor "${c.name}" has no byline in the window`);
  if (plan.dedication_post_id != null && !byId.has(plan.dedication_post_id)) errors.push(`dedication post ${plan.dedication_post_id} is not in the window`);
  return { ok: errors.length === 0, errors, plan };
}
