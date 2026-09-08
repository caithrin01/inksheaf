// Synthesized from the real calendar fixture and the 2026-09-05 audit's editor shape.
// This is a regression fixture, not a captured live editor response.
import { readFileSync } from 'node:fs';
export const calendar = JSON.parse(readFileSync(new URL('./preview-caithrin-2026-09-04.json', import.meta.url)));
calendar.editorial.pending = true;
export const editorial = structuredClone(calendar.editorial);
editorial.planned_by = 'editor';
editorial.pending = false;
const P = editorial.plan;
const removed = P.routes[0].volumes[0].post_ids[0];
P.excluded = [{ post_id: removed, reason: 'A 36-word launch announcement.' }];
for (const route of P.routes) {
  for (const v of route.volumes) {
    if (v.post_ids.includes(removed)) {
      v.post_ids = v.post_ids.filter(id => id !== removed);
      v.posts = v.post_ids.length;
      v.words -= 36;
      v.est_pages -= 1;
    }
  }
}
P.routes[1].why = 'Two roughly balanced books.';
const template = P.routes[0].volumes[0];
const ids = template.post_ids;
P.routes.push({ cadence:'quarterly', recommended:false,
  why:'Three books from four quarters, with the quieter quarters gathered together.',
  volumes:[
    { ...template, label:'Q3 2025', post_ids:ids.slice(0,4), posts:4, words:5000, est_pages:34 },
    { ...template, label:'Q4 2025 – Q1 2026', post_ids:ids.slice(4,9), posts:5, words:7669, est_pages:45 },
    { ...template, label:'Q2 2026', post_ids:ids.slice(9), posts:13, words:23332, est_pages:100 },
  ]
});
const cost = pages => ({bw:Math.round((1.99+.025*pages)*100)/100,color:Math.round((2+.04414*pages)*100)/100});
for (const r of P.routes) {
  for (const v of r.volumes) v.price=cost(v.est_pages);
  r.est_pages=r.volumes.reduce((a,v)=>a+v.est_pages,0);
  r.price=Object.fromEntries(['bw','color'].map(key=>[key,Math.round(r.volumes.reduce((a,v)=>a+v.price[key],0)*100)/100]));
}
P.infeasible = [{cadence:'monthly',reason:'Several months would make volumes too thin to bind.'}];
P.sentences.plan_headline = 'Your year is one book.';
P.sentences.plan_sub = 'Twenty-two essays, gathered into one volume.';
P.description = 'Twenty-two essays on work, software and the things that last.';
export const edited = {...structuredClone(calendar), editorial};
