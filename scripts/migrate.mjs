#!/usr/bin/env node
// Apply migrations/*.sql in order to a D1 database, recording each in schema_migrations.
//   node scripts/migrate.mjs --local     (the wrangler local database, for tests)
//   node scripts/migrate.mjs --remote    (production: only from the release workflow, P0-10)
// CREATE statements are idempotent by IF NOT EXISTS; ALTER TABLE ... ADD COLUMN lines are
// skipped when the column already exists (SQLite has no IF NOT EXISTS for columns).
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const target = process.argv.includes("--remote") ? "--remote" : "--local";
const DB = process.env.D1_NAME || "inksheaf-beta";
const run = (sql) => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", DB, target, "--json", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const rows = (r) => (Array.isArray(r) ? r[0]?.results : r?.results) || [];
run("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
const applied = new Set(rows(run("SELECT name FROM schema_migrations")).map(r => r.name));
const files = readdirSync("migrations").filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
for (const f of files) {
  if (applied.has(f)) { console.log("skip   ", f); continue; }
  const text = readFileSync(`migrations/${f}`, "utf8");
  const statements = text.split(/;\s*\n/).map(s => s.replace(/^\s*--[^\n]*\n?/gm, "").trim()).filter(Boolean);
  for (const st of statements) {
    const alter = st.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/i);
    if (alter) {
      const cols = rows(run(`PRAGMA table_info(${alter[1]})`)).map(c => c.name);
      if (cols.includes(alter[2])) { console.log("   have ", alter[1] + "." + alter[2]); continue; }
    }
    run(st);
  }
  run(`INSERT OR IGNORE INTO schema_migrations (name) VALUES ('${f}')`);
  console.log("applied", f);
}
const tables = rows(run("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")).map(r => r.name);
console.log("tables:", tables.join(" "));
