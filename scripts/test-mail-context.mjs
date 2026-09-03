// Codex control 2 / P0-3: /api/mail-context authenticates with the MAIL signature and returns the
// approved edition's actual pages; the mailing sig must NOT open the change capability and vice
// versa. Gated by the mailings flag. No network.
import { onRequest as mailCtx } from "../functions/api/mail-context.js";
import { onRequest as change } from "../functions/api/change.js";
import { hmacHex } from "../functions/lib/press-dispatch.js";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const ver = { volumes: JSON.stringify([{ label: "v1", pages: 294 }]), print_mode: "bw" };
const DB = { prepare(sql) { let a = []; return { bind(...x) { a = x; return this; },
  async first() { if (/FROM signups/.test(sql)) return { publication_url: "https://www.caithrin.com", plan_json: "null", id: 5 }; if (/FROM edition_versions/.test(sql)) return ver; return null; } }; } };
const env = { DB, ARCHIVE_RELAY_TOKEN: "t", MAILINGS_ENABLED: "1" };
const mailSig = await hmacHex("t", "mail:5");
const changeSig = await hmacHex("t", "change:5");
const get = (fn, sig) => fn({ request: new Request(`https://inksheaf.com/x?id=5&sig=${sig}`), env }).then(async r => ({ status: r.status, body: await r.json() }));

let r = await get(mailCtx, mailSig);
ok(r.status === 200 && r.body.ok, "mail-context accepts the mail signature");
ok(r.body.volumes?.[0]?.pages === 294, `returns actual pages 294 (got ${r.body.volumes?.[0]?.pages})`);
ok(r.body.interior === "bw", "returns the edition interior");

r = await get(mailCtx, changeSig);
ok(r.status === 403, "mail-context rejects the change signature (no cross-capability)");
r = await get(change, mailSig);
ok(r.status === 403, "change rejects the mail signature (no cross-capability)");

// disabled -> 503
r = await mailCtx({ request: new Request(`https://inksheaf.com/x?id=5&sig=${mailSig}`), env: { DB, ARCHIVE_RELAY_TOKEN: "t" } }).then(async x => x.status);
ok(r === 503, "mail-context is 503 when mailings disabled");

console.log(`mail-context: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
