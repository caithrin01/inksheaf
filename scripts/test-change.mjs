// The change endpoint with a fake database: what left the book is listed with reasons and the
// writer's include flags; a bad ISBN is refused before any archive read; no plan means 409.
import { onRequest } from "../functions/api/change.js";
import { hmacHex } from "../functions/lib/press-dispatch.js";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const TOKEN = "t"; const ID = 7;
function db({ plan, detail }) {
  return { prepare(sql) { return { bind() { return this; },
    async first() {
      if (/FROM signups/.test(sql)) return { id: ID, publication_url: "https://www.example.com", email: "w@example.com", plan_json: JSON.stringify(plan), created_at: "2026-09-02" };
      if (/SELECT detail FROM press/.test(sql)) return { detail: JSON.stringify(detail) };
      if (/FROM press/.test(sql)) return { status: "proofed", updated_at: "2026-09-02" };
      return null; },
    async run() { return {}; } }; } };
}
const sig = await hmacHex(TOKEN, `change:${ID}`);
const env = (o) => ({ ARCHIVE_RELAY_TOKEN: TOKEN, DB: db(o) });
const get = (o) => onRequest({ request: new Request(`https://inksheaf.com/api/change?id=${ID}&sig=${sig}`), env: env(o) }).then(r => r.json());
const post = (o, changes) => onRequest({ request: new Request("https://inksheaf.com/api/change", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: ID, sig, changes }) }), env: env(o) }).then(async r => ({ status: r.status, body: await r.json() }));

/* GET: press left_out plus the editor's exclusions, include flags from the plan; no volumes so no archive read */
const plan0 = { cadence: "single", interior: "bw", volumes: [], excluded: [], include: ["open-thread-9"] };
let d = await get({ plan: plan0, detail: { left_out: [{ slug: "open-thread-9", title: "Open thread 9", reason: "an open thread", kind: "rule" }, { slug: "guest-piece", title: "A guest piece", reason: "a guest post by Ann", kind: "guest" }] } });
ok(d.ok && d.left_out.length === 2, "left_out listed: " + JSON.stringify(d.left_out).slice(0, 120));
ok(d.left_out[0].included === true && d.left_out[1].included === false, "include flags follow the plan");
ok(d.isbn === null, "no isbn yet");

/* POST: a bad ISBN is refused before the archive is read (the fake env has no network path) */
const plan1 = { ...plan0, volumes: [{ label: "2025–26", post_ids: [1], est_pages: 100 }] };
let r = await post({ plan: plan1, detail: {} }, { isbn: "12345", exclude: [] });
ok(r.status === 400 && /ISBN/.test(r.body.error), "bad ISBN refused: " + r.status + " " + r.body.error);
r = await post({ plan: plan0, detail: {} }, { include: ["x"] });
ok(r.status === 409, "no plan to change: " + r.status);
console.log(`${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
