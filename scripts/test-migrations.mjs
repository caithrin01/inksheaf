// Clean-D1 migration test (Codex audit P0-9): wipe the local database, migrate, and walk the
// state transitions the product makes, in SQL, so every table and column the code writes exists.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const q = (sql) => { const r = JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "inksheaf-beta", "--local", "--json", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })); return (Array.isArray(r) ? r[0]?.results : r?.results) || []; };
rmSync(".wrangler/state", { recursive: true, force: true });
execFileSync("node", ["scripts/migrate.mjs", "--local"], { stdio: "ignore" });
const tables = q("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(r => r.name);
for (const t of ["signups", "events", "preview_cache", "press", "mailings", "links", "edition_versions", "stripe_events", "print_commands", "email_verifications", "allowlist", "quota_hits", "schema_migrations"]) ok(tables.includes(t), "table " + t);
/* the transaction, as rows */
q("INSERT INTO signups (publication_url, email, raw_json, plan_json) VALUES ('https://www.example.com', 'w@example.com', '{}', '{\"cadence\":\"single\"}')");
q("UPDATE signups SET email_verified_at = datetime('now'), dispatch_status = 'dispatched' WHERE id = 1");
q("INSERT INTO press (signup_id, status, detail) VALUES (1, 'building', '{}') ON CONFLICT(signup_id) DO UPDATE SET status = 'building'");
q("INSERT INTO edition_versions (signup_id, plan_json, post_ids, body_hashes, renderer_sha, print_mode, volumes, proof_key, proof_sha256, pages, status) VALUES (1, '{}', '[1,2]', '{\"1\":\"a\",\"2\":\"b\"}', 'deadbeef', 'bw', '[]', 'proofs/x.pdf', 'abc', 150, 'proofed')");
q("UPDATE edition_versions SET status = 'approved', approved_at = datetime('now'), approval_nonce = NULL WHERE id = 1 AND status = 'proofed'");
q("INSERT INTO mailings (signup_id, level, addresses, quote, status, version_id, amount_cents, currency) VALUES (1, 'MAIL', '[]', '{}', 'checkout', 1, 1466, 'usd')");
q("INSERT INTO stripe_events (id, type, mailing_id, outcome) VALUES ('evt_1', 'checkout.session.completed', 1, 'claimed')");
q("UPDATE mailings SET status = 'dispatching', stripe_event_id = 'evt_1' WHERE id = 1 AND status = 'checkout'");
q("INSERT INTO print_commands (mailing_id, version_id, external_id, status) VALUES (1, 1, 'inksheaf-m1-v1', 'queued')");
q("INSERT INTO email_verifications (token, email, signup_id, expires_at) VALUES ('t1', 'w@example.com', 1, datetime('now', '+1 day'))");
q("INSERT INTO allowlist (email, host) VALUES ('w@example.com', 'www.example.com')");
q("INSERT INTO quota_hits (key, bucket, n) VALUES ('host:www.example.com', '2026-09-02T23', 1) ON CONFLICT(key, bucket) DO UPDATE SET n = n + 1");
ok(q("SELECT status FROM mailings WHERE id = 1")[0].status === "dispatching", "mailing claimed");
ok(q("SELECT status FROM edition_versions WHERE id = 1")[0].status === "approved", "version approved");
ok(q("SELECT count(*) AS n FROM print_commands")[0].n === 1, "one print command");
let dup = false; try { q("INSERT INTO stripe_events (id, type) VALUES ('evt_1', 'x')"); } catch { dup = true; } ok(dup, "a replayed Stripe event id is refused");
let dup2 = false; try { q("INSERT INTO print_commands (mailing_id, external_id) VALUES (1, 'inksheaf-m1-v1-b')"); } catch { dup2 = true; } ok(dup2, "a second print command for the same mailing is refused");
console.log(`${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
