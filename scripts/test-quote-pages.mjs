// Codex control 1 / P0-2: /api/quote prices the APPROVED edition by its ACTUAL page count, from
// edition_versions, not the plan estimate; and refuses to price when no approved edition exists.
// No Lulu keys in the test env, so it exercises the stored-quote/actual-pages path. No network.
import { onRequest } from "../functions/api/quote.js";
import { hmacHex } from "../functions/lib/press-dispatch.js";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };

function db(verRow) {
  return { prepare(sql) { let a = []; return { bind(...x) { a = x; return this; },
    async first() { return /FROM edition_versions/.test(sql) ? verRow : null; } }; } };
}
const env = (verRow) => ({ DB: db(verRow), ARCHIVE_RELAY_TOKEN: "t", MAILINGS_ENABLED: "1" }); // no LULU keys -> estimated path
const sig = await hmacHex("t", "mail:5");
const addr = [{ name: "A", street1: "1 St", city: "SF", state_code: "CA", postcode: "94110", quantity: 2 }];
const call = (e, body) => onRequest({ request: new Request("https://inksheaf.com/api/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), env: e }).then(async r => ({ status: r.status, body: await r.json() }));

// approved version, 294 actual pages, stored per-copy print cost $9.34
const ver = { pages: 294, print_mode: "bw", quote_json: JSON.stringify({ print_cost: 9.34 }), status: "listed", volumes: JSON.stringify([{ label: "v1", pages: 294 }]) };
let r = await call(env(ver), { id: 5, sig, level: "MAIL", addresses: addr });
ok(r.status === 200 && r.body.ok, "prices when an approved edition exists");
ok(r.body.volumes?.[0]?.pages === 294, `returns ACTUAL pages 294 (got ${r.body.volumes?.[0]?.pages})`);
ok(r.body.quotes?.[0]?.print === 18.68, `print = stored $9.34 x 2 copies = 18.68 (got ${r.body.quotes?.[0]?.print})`);
ok(r.body.payment === "lulu-direct", "payment is lulu-direct, not stripe");

// no approved edition -> refuse, do not quote off an estimate
r = await call(env(null), { id: 5, sig, level: "MAIL", addresses: addr });
ok(r.status === 409 && /approve your proof/.test(r.body.error), "refuses to price with no approved edition (409)");

// mailings off -> 503 before any of this (control 3 interaction)
r = await call({ DB: db(ver), ARCHIVE_RELAY_TOKEN: "t" }, { id: 5, sig, level: "MAIL", addresses: addr });
ok(r.status === 503, "still 503 when mailings disabled");

console.log(`quote-pages: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
