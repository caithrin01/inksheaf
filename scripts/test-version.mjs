// The version endpoint: a signed POST records a version, supersedes the older proofed one and
// returns a nonce; a bad signature or a missing field is refused; GET needs the signup's signature.
import { onRequest } from "../functions/api/version.js";
import { hmacHex } from "../functions/lib/press-dispatch.js";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const rows = []; const sqls = [];
const DB = { prepare(sql) { let args = []; return { bind(...a) { args = a; return this; },
  async first() { if (/FROM edition_versions/.test(sql)) return rows.find(r => r.id === args[0]) || null; return null; },
  async run() { sqls.push(sql.slice(0, 50)); if (/INSERT INTO edition_versions/.test(sql)) { rows.push({ id: rows.length + 1, signup_id: args[0], status: "proofed", approval_nonce: args[10], proof_sha256: args[8] }); return { meta: { last_row_id: rows.length } }; }
    if (/SET status = 'superseded'/.test(sql)) for (const r of rows) if (r.signup_id === args[0] && r.status === "proofed") r.status = "superseded"; return { meta: {} }; } }; } };
const env = { DB, ARCHIVE_RELAY_TOKEN: "t" };
const sig = await hmacHex("t", "version:9");
const body = { signup_id: 9, sig, plan_json: { cadence: "single" }, post_ids: [{ id: 1, slug: "a" }], body_hashes: { 1: "x" }, renderer_sha: "abc", print_mode: "bw", volumes: [{ label: "v", pages: 10 }], proof_key: "proofs/k.pdf", proof_sha256: "e".repeat(64), pages: 10 };
const post = (b) => onRequest({ request: new Request("https://inksheaf.com/api/version", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }), env }).then(async r => ({ status: r.status, body: await r.json() }));
let r = await post(body); ok(r.status === 200 && r.body.version_id === 1 && /^[0-9a-f]{36}$/.test(r.body.nonce), "first version recorded with a nonce: " + JSON.stringify(r.body));
r = await post(body); ok(r.status === 200 && r.body.version_id === 2 && rows[0].status === "superseded" && rows[1].status === "proofed", "a second proof supersedes the first");
r = await post({ ...body, sig: "nope" }); ok(r.status === 403, "bad signature refused");
r = await post({ ...body, proof_sha256: "short" }); ok(r.status === 400, "digest must be sha256 hex");
const { proof_key, ...missing } = body; r = await post(missing); ok(r.status === 400 && /proof_key/.test(r.body.error), "missing field named");
let g = await onRequest({ request: new Request(`https://inksheaf.com/api/version?id=2&sig=${sig}`), env }).then(async x => ({ status: x.status, body: await x.json() }));
ok(g.status === 200 && g.body.version.id === 2 && !("approval_nonce" in g.body.version), "GET returns the version without its nonce");
g = await onRequest({ request: new Request(`https://inksheaf.com/api/version?id=2&sig=bad`), env }).then(x => x.status); ok(g === 403, "GET with a bad signature refused");
console.log(`${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
