import { prepareOutboundEmail, pressEventType, luluUsesProduction, runtimeMode } from "../functions/lib/runtime.js";
import { dispatchPress } from "../functions/lib/press-dispatch.js";
import { sendMail } from "./lib/mail.mjs";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (condition, name) => { if (condition) { pass++; console.log("ok  ", name); } else { fail++; console.error("FAIL", name); } };

ok(runtimeMode({}) === "development", "an unspecified environment is not production");
ok(luluUsesProduction({ INKSHEAF_ENV: "production" }) === true, "production selects Lulu production");
ok(luluUsesProduction({ INKSHEAF_ENV: "staging" }) === false, "staging selects Lulu sandbox");
ok(luluUsesProduction({}) === false, "development selects Lulu sandbox");
ok(pressEventType({ INKSHEAF_ENV: "production" }, "press") === "press", "production dispatch keeps the production event");
ok(pressEventType({ INKSHEAF_ENV: "staging" }, "press") === "staging-press", "staging cannot hit the production press event");
ok(pressEventType({}, "mail") === "staging-mail", "development cannot hit the production mail event");

const staged = prepareOutboundEmail({ INKSHEAF_ENV: "staging", STAGING_EMAIL: "test@inksheaf.com" }, { to: ["writer@example.com"], subject: "Your proof", text: "Ready" });
ok(staged.to.length === 1 && staged.to[0] === "test@inksheaf.com", "staging rewrites the recipient to the allowlist");
ok(staged.subject === "[staging] Your proof", "staging labels the subject");
ok(staged.text.startsWith("Intended recipient: writer@example.com"), "staging records but does not contact the intended recipient");

let blocked = false;
try { prepareOutboundEmail({ INKSHEAF_ENV: "staging" }, { to: ["writer@example.com"], subject: "x", text: "y" }); }
catch (e) { blocked = /STAGING_EMAIL/.test(e.message); }
ok(blocked, "staging without an allowlisted inbox fails closed");

const production = prepareOutboundEmail({ INKSHEAF_ENV: "production" }, { to: ["writer@example.com"], subject: "Your proof", text: "Ready" });
ok(production.to[0] === "writer@example.com" && production.subject === "Your proof", "production preserves the intended recipient");

let dispatched;
const originalFetch = global.fetch;
global.fetch = async (_url, options) => { dispatched = JSON.parse(options.body); return { status: 204 }; };
await dispatchPress({ INKSHEAF_ENV: "staging", GITHUB_DISPATCH_TOKEN: "test", PRESS_REPO: "example/test" }, { event: "press", signup_id: 7 });
global.fetch = originalFetch;
ok(dispatched.event_type === "staging-press", "the real dispatch helper namespaces staging events");
ok(dispatched.client_payload.environment === "staging", "the real dispatch payload records its environment");

const oldCwd = process.cwd(), oldKey = process.env.RESEND_API_KEY, oldInbox = process.env.STAGING_EMAIL;
const dryDir = mkdtempSync(join(tmpdir(), "inksheaf-mail-safe-"));
delete process.env.RESEND_API_KEY; delete process.env.STAGING_EMAIL;
process.chdir(dryDir);
const dry = await sendMail({ to: "writer@example.com", subject: "Dry proof", text: "Ready" });
process.chdir(oldCwd);
if (oldKey == null) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = oldKey;
if (oldInbox == null) delete process.env.STAGING_EMAIL; else process.env.STAGING_EMAIL = oldInbox;
const dryMessage = JSON.parse(readFileSync(join(dryDir, dry.file), "utf8"));
ok(dry.dry === true && dryMessage.to[0] === "writer@example.com", "a no-key local run writes the intended email to a private outbox without sending");

console.log(`runtime-safety: ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
