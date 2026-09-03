// The listing worker: pulls the queue, drives the GraphQL driver, reports the URL back, and on a
// Lulu failure leaves the edition at listing-pending and continues. Runs against a MOCKED Lulu and
// a MOCKED site (no real network, no real login). The live publish is the operator's run.
process.env.ARCHIVE_RELAY_TOKEN = "t";
process.env.INKSHEAF_API = "https://test.inksheaf";
process.env.PROOF_STORE_TOKEN = "x";
process.env.PROOF_STORE_BASE = "https://proofs.test";
// a bearer token with a far-future exp so the driver treats it as fresh
const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64");
process.env.LULU_BEARER = `h.${payload}.s`;

const { createHmac } = await import("node:crypto");
const hmac = s => createHmac("sha256", "t").update(s).digest("hex");
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };

// a Lulu response that carries every field any op reads (a superset is fine; callers read one key)
const luluOK = { data: { createProject: { id: "P1", availableOperations: [] }, createDirectUploadURL: { uploadUrl: "https://lulu.test/upload", fileId: 5 },
  setInteriorFile: { id: "P1" }, setCoverFile: { id: "P1" }, patchProject: { id: "P1", luluBookstoreSellIntention: "DIRECT" }, createPayee: { id: "PAY" },
  setProjectRevenueShares: [{ payeeId: "PAY", share: 100 }], publishLastVersion: { id: "P1", status: "IN_REVIEW" }, retireProject: { id: "P1" },
  project: { id: "P1", status: "IN_REVIEW", shopUrl: "https://www.lulu.com/shop/p1.html", publicUrl: null } } };

const QUEUE = [{ signup_id: 9, version_id: 1, host: "weijinresearch.substack.com", print_mode: "bw",
  built: [{ label: "2025–2026", pubName: "Weijin Research", pages: 148, interiorKey: "proofs/i.pdf", coverKey: "proofs/c.pdf", sha256: "d" }] }];

// install a fetch mock; `fails` optionally makes the Lulu publish op error
function install({ luluFails = false } = {}) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    url = String(url); const body = typeof opts.body === "string" ? JSON.parse(opts.body) : null; calls.push({ url, method: opts.method || "GET", body });
    const J = o => ({ ok: true, status: 200, json: async () => o, arrayBuffer: async () => new ArrayBuffer(8), text: async () => JSON.stringify(o) });
    if (url.includes("/api/list-queue")) return J({ ok: true, count: QUEUE.length, queue: QUEUE });
    if (url.includes("/api/listed")) return J({ ok: true, listing_url: body.listing_url });
    if (url.includes("/api/press-status")) return J({ ok: true });
    if (url.includes("proofs.test/proof")) return J({});                 // asset bytes
    if (url === "https://lulu.test/upload") return { ok: true, status: 200, text: async () => "" }; // signed PUT
    if (url.includes("api.lulu.com/graphql")) {
      const op = body?.query || "";
      if (luluFails && /publishLastVersion/.test(op)) return J({ data: null, errors: [{ message: "boom", extensions: { code: "INTERNAL" } }] });
      return J(luluOK);
    }
    throw new Error("unexpected fetch " + url);
  };
  return calls;
}

const { pass: workerPass } = await import("./lulu-worker.mjs");

// Case A: happy path -> the edition is listed and reported back
let calls = install({ luluFails: false });
let r = await workerPass();
ok(r.listed === 1 && r.failed === 0 && r.total === 1, `happy path lists 1 (${JSON.stringify(r)})`);
const listedCall = calls.find(c => c.url.includes("/api/listed"));
ok(listedCall && listedCall.body.listing_url === "https://www.lulu.com/shop/p1.html", "reports the shop URL to /api/listed");
ok(listedCall && listedCall.body.sig === hmac("listed:9"), "the /api/listed call is signed for signup 9");
ok(calls.some(c => c.url.includes("api.lulu.com/graphql") && /createProject/.test(c.body.query)), "actually drove the Lulu GraphQL API");

// Case B: Lulu fails at publish -> not reported as listed; press-status notes it; batch survives
calls = install({ luluFails: true });
r = await workerPass();
ok(r.listed === 0 && r.failed === 1, `a Lulu failure counts as failed, not listed (${JSON.stringify(r)})`);
ok(!calls.some(c => c.url.includes("/api/listed")), "no /api/listed call when the listing failed");
const ps = calls.find(c => c.url.includes("/api/press-status"));
ok(ps && /automated listing failed/.test(ps.body.message), "press-status records the failure for the hand-made fallback");
ok(calls.some(c => c.url.includes("api.lulu.com/graphql") && /retireProject/.test(c.body.query)), "the half-built project is retired on failure");

console.log(`lulu-worker: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
