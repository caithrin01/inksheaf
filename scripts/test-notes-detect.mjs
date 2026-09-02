// The source-notes detector against real archives. caithrin.com: 7 of 23 posts end in a notes
// section (verified by hand 2026-09-02); the others must not be marked. Negatives: recent posts
// from two publications whose essays end in prose. Usage: node scripts/test-notes-detect.mjs [--model]
import { detectNotes, askModel } from "./lib/notes-detect.mjs";
const UA = { "user-agent": "Mozilla/5.0 (inksheaf test)" };
const useModel = process.argv.includes("--model");
const EXPECT = new Set(["the-data-center-backlash-wont-last", "ten-us-china-ai-deals-we-could-sign", "fearmongering-the-frontier", "helpful-assistant-ais-original-sin", "stop-counting-empires-in-years", "cargo-cult-vannevar-bush", "what-were-talking-about-when-were"]); /* 7 of 23; "the-singapore-safety-cluster-what" ends in prose under "The test" */
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
async function posts(host, n) { const a = await (await fetch(`https://${host}/api/v1/archive?sort=new&limit=${n}`, { headers: UA })).json(); const out = []; for (const p of a) { const f = await (await fetch(`https://${host}/api/v1/posts/${p.slug}`, { headers: UA })).json(); if (f.body_html && f.audience === "everyone") out.push(f); } return out; }
const c = await posts("www.caithrin.com", 50);
for (const p of c) {
  let d = detectNotes(p.body_html); let method = d ? d.method : "none";
  if (d && d.method === "ambiguous") { const m = useModel ? await askModel(d.heading, p.body_html.slice(d.start)) : null; if (m === false) d = null; method = m == null ? "ambiguous" : m ? "model" : "model-no"; }
  const marked = !!d && d.method !== "ambiguous";
  const want = EXPECT.has(p.slug);
  ok(marked === want, `${p.slug}: marked ${marked} (${method}, score ${d ? d.score : "-"}, heading "${d ? d.heading.slice(0, 30) : ""}") wanted ${want}`);
  if (marked === want) console.log("ok  ", p.slug.slice(0, 40).padEnd(40), want ? `notes via ${method}, score ${d.score}` : "no notes");
}
for (const host of ["www.slowboring.com", "www.astralcodexten.com"]) {
  const ps = await posts(host, 8);
  for (const p of ps) { let d = detectNotes(p.body_html); let how = d ? d.method : "none";
    if (d && d.method === "ambiguous") { const m = useModel ? await askModel(d.heading, p.body_html.slice(d.start)) : null; how = m == null ? "ambiguous" : m ? "model-yes" : "model-no"; if (m !== true) d = null; }
    const marked = !!d && d.method !== "ambiguous"; ok(!marked, `${host} ${p.slug}: marked as notes (${how})`); if (!marked) console.log("ok  ", `${host.replace("www.", "")} ${p.slug.slice(0, 30)}`.padEnd(40), how); }
}
console.log(`${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
