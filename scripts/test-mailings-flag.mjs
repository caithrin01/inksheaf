// Codex reopened control 3: the Stripe mailing route is OFF in code, not merely because a secret is
// absent. With STRIPE_SECRET_KEY present but MAILINGS_ENABLED off, /api/quote and /api/mail must
// return 503 and the webhook must do nothing; with the flag on, the gate is lifted. No network.
import { onRequest as quote } from "../functions/api/quote.js";
import { onRequest as mail } from "../functions/api/mail.js";
import { onRequest as webhook } from "../functions/api/stripe-webhook.js";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const req = (body) => new Request("https://inksheaf.com/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const off = { STRIPE_SECRET_KEY: "sk_test", ARCHIVE_RELAY_TOKEN: "t" };                 // key present, flag absent -> off
const on = { STRIPE_SECRET_KEY: "sk_test", ARCHIVE_RELAY_TOKEN: "t", MAILINGS_ENABLED: "1" };

let r = await quote({ request: req({ id: 1, sig: "x" }), env: off });
ok(r.status === 503, `quote is 503 when mailings off despite the Stripe key (got ${r.status})`);
r = await mail({ request: req({ id: 1, sig: "x" }), env: off });
ok(r.status === 503, `mail is 503 when mailings off (got ${r.status})`);
r = await webhook({ request: req({ type: "checkout.session.completed" }), env: off });
ok(r.status === 200 && (await r.text()) === "mailings disabled", "webhook does nothing (200) when mailings off");

// with the flag on, the gate is lifted: a bad signature now reaches the auth check (403), not 503
r = await quote({ request: req({ id: 1, sig: "bad" }), env: on });
ok(r.status === 403, `with flag on, quote passes the gate and hits auth (got ${r.status})`);
r = await mail({ request: req({ id: 1, sig: "bad" }), env: on });
ok(r.status === 403, `with flag on, mail passes the gate and hits auth (got ${r.status})`);

console.log(`mailings-flag: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
