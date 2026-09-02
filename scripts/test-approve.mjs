// Approval is version-bound and single-use (Codex audit P0-1, P0-5): GET mutates nothing; one
// POST with the nonce approves; a second POST or a replay finds nothing; a wrong nonce is refused.
import { onRequest } from "../functions/api/approve.js";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const NONCE = "a".repeat(36);
function db() {
  const state = { versions: { 5: { id: 5, signup_id: 9, status: "proofed", pages: 150, print_mode: "bw", volumes: JSON.stringify([{ label: "2025–26", pages: 150 }]), proof_sha256: "f".repeat(64), approval_nonce: NONCE } }, writes: [] };
  const api = { prepare(sql) { let args = []; return { bind(...a) { args = a; return this; },
    async first() { if (/FROM edition_versions/.test(sql)) return state.versions[args[0]] || null; if (/FROM signups/.test(sql)) return { publication_url: "https://www.example.com", email: "w@example.com", plan_json: "{}" }; return null; },
    async run() { state.writes.push(sql.slice(0, 60));
      if (/UPDATE edition_versions SET status = 'approved'/.test(sql)) { const v = state.versions[args[1]]; if (v && v.status === "proofed" && v.approval_nonce === args[2]) { v.status = "approved"; v.approval_nonce = null; return { meta: { changes: 1 } }; } return { meta: { changes: 0 } }; }
      return { meta: { changes: 0 } }; } }; } };
  return { api, state };
}
const env = (d) => ({ DB: d.api, ARCHIVE_RELAY_TOKEN: "t", GITHUB_DISPATCH_TOKEN: "" });
const get = (d, v, n) => onRequest({ request: new Request(`https://inksheaf.com/api/approve?v=${v}&n=${n}`), env: env(d) });
const post = (d, v, n) => { const f = new FormData(); f.set("v", String(v)); f.set("n", n); return onRequest({ request: new Request("https://inksheaf.com/api/approve", { method: "POST", body: f }), env: env(d) }); };
let d = db();
let r = await get(d, 5, NONCE); let t = await r.text();
ok(r.status === 200 && /Approve this proof\?/.test(t) && /150 pages/.test(t) && /\$\d+\.\d\d/.test(t), "GET shows the version, pages and price");
ok(d.state.versions[5].status === "proofed" && d.state.writes.length === 0, "GET wrote nothing: " + JSON.stringify(d.state.writes));
r = await get(d, 5, "b".repeat(36)); ok(r.status === 403, "wrong nonce refused on GET");
r = await post(d, 5, "b".repeat(36)); ok(r.status === 403, "wrong nonce refused on POST");
r = await post(d, 5, NONCE); t = await r.text();
ok(r.status === 200 && /^<!doctype html>[\s\S]*<h1>Approved\.<\/h1>/.test(t) && d.state.versions[5].status === "approved", "one POST approves");
r = await post(d, 5, NONCE); t = await r.text();
ok(/Already approved/.test(t) && d.state.writes.filter(w => /status = 'approved'/.test(w)).length === 1 && d.state.versions[5].approval_nonce === null, "a replay approves nothing new");
console.log(`${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
