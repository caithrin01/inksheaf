// The /api/list-queue endpoint: a signed POST returns editions at listing-pending that still need a
// Lulu listing, shaped as manifests the worker can drive; a bad signature is refused; editions with
// no built files are filtered out. No network.
import { onRequest } from "../functions/api/list-queue.js";
import { hmacHex } from "../functions/lib/press-dispatch.js";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };

const dbRows = [
  // ready: listing-pending, no listing_url, has interior+cover keys
  { version_id: 1, signup_id: 9, print_mode: "bw", publication_url: "https://weijinresearch.substack.com", email: "a@b.com",
    volumes: JSON.stringify([{ label: "2025–2026", pages: 148, pubName: "Weijin Research", key: "proofs/int1.pdf", coverKey: "proofs/cov1.pdf", sha256: "d1" }]),
    quote_json: JSON.stringify({ print_cost: 5.69 }) },
  // not ready: no cover key -> filtered out
  { version_id: 2, signup_id: 10, print_mode: "bw", publication_url: "https://x.substack.com", email: "c@d.com",
    volumes: JSON.stringify([{ label: "2026", pages: 90, key: "proofs/int2.pdf" }]), quote_json: null },
];
const DB = { prepare(sql) { let args = []; return { bind(...a) { args = a; return this; },
  async all() { if (/FROM edition_versions v JOIN signups/.test(sql)) return { results: dbRows }; return { results: [] }; } }; } };
const env = { DB, ARCHIVE_RELAY_TOKEN: "t" };
const post = (b) => onRequest({ request: new Request("https://inksheaf.com/api/list-queue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }), env }).then(async r => ({ status: r.status, body: await r.json() }));

let r = await post({ sig: await hmacHex("t", "list-queue") });
ok(r.status === 200 && r.body.ok, "signed request returns 200");
ok(r.body.count === 1, `only the ready edition is returned (count ${r.body.count})`);
const e = r.body.queue[0];
ok(e && e.host === "weijinresearch.substack.com", "host derived from publication_url without scheme: " + e?.host);
ok(e && e.version_id === 1 && e.signup_id === 9, "carries signup and version ids");
ok(e && e.built[0].interiorKey === "proofs/int1.pdf" && e.built[0].coverKey === "proofs/cov1.pdf", "built carries interior and cover keys");
ok(e && e.built[0].pubName === "Weijin Research" && e.built[0].pages === 148, "built carries pubName and pages");
ok(e && e.print_mode === "bw" && e.quote.print_cost === 5.69, "carries print mode and quote");

r = await post({ sig: "nope" }); ok(r.status === 403, "bad signature refused");
r = await post({}); ok(r.status === 403, "missing signature refused");

console.log(`list-queue: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
