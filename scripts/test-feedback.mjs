#!/usr/bin/env node
// Unit gate for the feedback endpoint: the row lands with every whitelisted field, and the caps,
// honeypot and rate limit hold. Mocked D1.
import { strict as assert } from "node:assert";
import { onRequest } from "../functions/api/feedback.js";
let n = 0; const ok = (name, c) => { n++; assert.ok(c, name); console.log("ok   " + name); };
function mockDB(log, recent = 0) {
  return { prepare(sql) { return { bind(...args) { return { run: async () => { log.push({ sql, args }); }, first: async () => null }; }, first: async () => ({ n: recent }), run: async () => {} }; } };
}
const req = (body, ua = "TestBrowser/1.0") => ({ method: "POST", headers: { get: h => h === "content-length" ? String(JSON.stringify(body).length) : h === "user-agent" ? ua : null }, json: async () => body });
let log = [];
let r = await onRequest({ request: req({ text: "The page turn is lovely but the price line confused me.", email: "Writer@Example.com", publication: "example.substack.com", page: "/" }), env: { DB: mockDB(log) } });
ok("a remark is accepted", r.status === 200 && (await r.json()).ok === true);
const ins = log.find(x => x.sql.includes("INSERT INTO feedback"));
ok("row inserted with text, lowercased email, publication, page, ua", ins && ins.args[0].startsWith("The page turn") && ins.args[1] === "writer@example.com" && ins.args[2] === "example.substack.com" && ins.args[3] === "/" && ins.args[4] === "TestBrowser/1.0");
ok("placeholders match binds", (ins.sql.match(/\?/g) || []).length === ins.args.length);
log = []; r = await onRequest({ request: req({ text: "Nice.", website: "http://spam" }), env: { DB: mockDB(log) } });
ok("honeypot: pretend success, store nothing", r.status === 200 && !log.length);
r = await onRequest({ request: req({ text: "hi" }), env: { DB: mockDB([]) } });
ok("too short is refused with a sentence", r.status === 400 && /one sentence/.test((await r.json()).error));
r = await onRequest({ request: req({ text: "x".repeat(4001) }), env: { DB: mockDB([]) } });
ok("too long is refused", r.status === 400);
r = await onRequest({ request: req({ text: "A real remark here.", email: "not-an-email" }), env: { DB: mockDB([]) } });
ok("a bad email is refused, blank allowed", r.status === 400);
log = []; r = await onRequest({ request: req({ text: "A real remark here." }), env: { DB: mockDB(log) } });
ok("blank email stored as null", (await r.json()).ok && log[0].args[1] === null);
r = await onRequest({ request: req({ text: "A real remark here." }), env: { DB: mockDB([], 30) } });
ok("thirty in a minute: busy", r.status === 429);
r = await onRequest({ request: { method: "GET", headers: { get: () => null } }, env: {} });
ok("GET is refused", r.status === 405);
r = await onRequest({ request: req({ text: "A real remark here." }), env: { DB: { prepare() { return { bind() { return { run: async () => { throw new Error("D1 down"); } }; }, first: async () => ({ n: 0 }) }; } } } });
ok("a failed insert says where else to write", r.status === 500 && /caithrin@caithrin\.com/.test((await r.json()).error));
console.log(`feedback: ${n} pass, 0 fail`);
