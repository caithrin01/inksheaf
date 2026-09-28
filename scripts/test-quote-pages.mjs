// /api/quote prices the newest finished edition by its ACTUAL page count, from edition_versions,
// adds Inksheaf's amount per printed book as its own line, and refuses when no book is finished
// or its print files have not passed Lulu's checks.
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

// a listed version, 294 actual pages, stored per-copy print cost $9.34
const ver = { id: 7, pages: 294, print_mode: "bw", quote_json: JSON.stringify({ print_cost: 9.34 }), status: "listed", volumes: JSON.stringify([{ label: "v1", pages: 294 }]) };
let r = await call(env(ver), { id: 5, sig, level: "MAIL", addresses: addr });
ok(r.status === 200 && r.body.ok, "prices when a finished edition exists");
ok(r.body.volumes?.[0]?.pages === 294, `returns ACTUAL pages 294 (got ${r.body.volumes?.[0]?.pages})`);
ok(r.body.quotes?.[0]?.print === 18.68, `print = stored $9.34 x 2 copies = 18.68 (got ${r.body.quotes?.[0]?.print})`);
ok(r.body.payment === "invoice", "no Stripe key: invoice");
ok(r.body.quotes[0].inksheaf === 4 && r.body.totals.inksheaf === 4 && r.body.totals.books === 2 && r.body.totals.per_book === 2, "Inksheaf adds $2 for each of 2 printed books");
ok(r.body.totals.total === Math.round((r.body.totals.lulu_total + 4) * 100) / 100, "total = Lulu's total + Inksheaf's line");
ok(r.body.version_id === 7, "reports the priced version");
r = await call({ ...env(ver), STRIPE_SECRET_KEY: "sk_test_x" }, { id: 5, sig, level: "MAIL", addresses: addr });
ok(r.body.payment === "stripe", "Stripe key: stripe");

// a two-volume set is two printed books per copy
const two = { ...ver, volumes: JSON.stringify([{ label: "v1", pages: 200 }, { label: "v2", pages: 180 }]) };
r = await call(env(two), { id: 5, sig, level: "MAIL", addresses: addr });
ok(r.body.totals.books === 4 && r.body.totals.inksheaf === 8, `2 sets of 2 volumes = 4 books, $8 (got ${r.body.totals.books}, ${r.body.totals.inksheaf})`);

// the newest finished book is priced only once its print files passed Lulu's checks
const files = [{ label: "v1", pages: 294, interiorKey: "i", coverKey: "c", validated: true }];
r = await call(env({ ...ver, status: "proofed", files_json: null }), { id: 5, sig, level: "MAIL", addresses: addr });
ok(r.status === 409 && r.body.code === "print-files-pending", "proofed without files: pending");
r = await call(env({ ...ver, status: "proofed", files_json: JSON.stringify([{ ...files[0], validated: false }]) }), { id: 5, sig, level: "MAIL", addresses: addr });
ok(r.status === 409 && r.body.code === "print-files-review", "proofed with failed checks: needs a person");
r = await call(env({ ...ver, status: "validated", files_json: JSON.stringify(files) }), { id: 5, sig, level: "MAIL", addresses: addr });
ok(r.status === 200 && r.body.print_ready === true, "validated files: print ready");

// international: the state is required only where Lulu needs it
r = await call(env(ver), { id: 5, sig, level: "MAIL", addresses: [{ name: "B", street1: "1 High St", city: "Oxford", postcode: "OX1 1AA", country_code: "gb", quantity: 1 }] });
ok(r.body.quotes?.[0]?.ok === true && r.body.quotes[0].address.country_code === "GB", "a UK address needs no state");
r = await call(env(ver), { id: 5, sig, level: "MAIL", addresses: [{ name: "C", street1: "1 St", city: "SF", postcode: "94110", country_code: "US", quantity: 1 }] });
ok(r.body.quotes?.[0]?.ok === false && /state/.test(r.body.quotes[0].error), "a US address still needs a state");

// no finished edition -> refuse, do not quote off an estimate
r = await call(env(null), { id: 5, sig, level: "MAIL", addresses: addr });
ok(r.status === 409 && /not finished/.test(r.body.error), "refuses to price with no finished edition (409)");

// mailings off -> 503 before any of this (control 3 interaction)
r = await call({ DB: db(ver), ARCHIVE_RELAY_TOKEN: "t" }, { id: 5, sig, level: "MAIL", addresses: addr });
ok(r.status === 503, "still 503 when mailings disabled");

console.log(`quote-pages: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
