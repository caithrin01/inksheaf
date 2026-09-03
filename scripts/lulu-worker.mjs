#!/usr/bin/env node
// The private listing worker (plan-lulu-listing-v1, the two-box hosted design). It is the ONLY
// thing signed in to the Inksheaf Lulu account. The public site holds no Lulu credentials; it just
// marks editions "listing-pending". This worker pulls that queue, lists each edition on Lulu via
// scripts/lulu-gql.mjs (route 2a), and reports the shop URL back through /api/listed. On any Lulu
// failure it leaves the edition at listing-pending (the hand-made-URL fallback) and moves on; one
// bad edition never stops the batch.
//
// SETUP (once): node scripts/lulu-gql.mjs --login   (sign in as the INKSHEAF Lulu account, not a
//   personal one; the token is saved to ~/.secrets/lulu-bearer and refreshed on re-login).
// RUN: node scripts/lulu-worker.mjs --once            one pass over the queue
//      node scripts/lulu-worker.mjs --watch [--interval 300]   loop every N seconds
//      [--dry-run]     fetch the queue and print what it would do, touch Lulu for nothing
//      [--no-publish]  build each draft on Lulu but do not publish (inspect first)
//      [--limit 10]    how many editions to pull per pass
//
// Secrets, outside the repo: ~/.secrets/inksheaf-relay-token (to sign site calls, or env
// ARCHIVE_RELAY_TOKEN) and ~/.secrets/lulu-bearer (the Inksheaf Lulu token, via lulu-gql --login).
import { readFileSync, existsSync } from "node:fs";
import { createHmac } from "node:crypto";
import { listEdition, LuluListingError } from "./lulu-gql.mjs";
import { signedProofUrl } from "./lib/proof-store.mjs";

const API = process.env.INKSHEAF_API || "https://inksheaf.com";
const TOKEN = process.env.ARCHIVE_RELAY_TOKEN || (existsSync(`${process.env.HOME}/.secrets/inksheaf-relay-token`) ? readFileSync(`${process.env.HOME}/.secrets/inksheaf-relay-token`, "utf-8").trim() : "");
const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const has = f => process.argv.includes(f);
const DRY = has("--dry-run");
// the Inksheaf listing identity (its own account's payee and default category)
const PAYEE_ID = process.env.INKSHEAF_LULU_PAYEE_ID || null;
const CATEGORY = process.env.INKSHEAF_LULU_CATEGORY || "LITERARY COLLECTIONS";
const hmac = s => createHmac("sha256", TOKEN).update(s).digest("hex");

async function post(path, body) {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(`${path} -> ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

async function fetchQueue(limit) {
  if (!TOKEN) throw new Error("no relay token (~/.secrets/inksheaf-relay-token or ARCHIVE_RELAY_TOKEN)");
  const j = await post("/api/list-queue", { sig: hmac("list-queue"), limit });
  return j.queue || [];
}

async function readAsset(key) {
  if (DRY) return Buffer.alloc(0);
  const r = await fetch(signedProofUrl(key));
  if (!r.ok) throw new LuluListingError("asset", `proof ${key} fetch HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function listOne(edition) {
  const manifest = { id: edition.signup_id, version_id: edition.version_id, host: edition.host,
    built: edition.built, interior: edition.print_mode, category: CATEGORY, payeeId: PAYEE_ID };
  const res = await listEdition(manifest, { publish: !has("--no-publish"), readAsset });
  if (DRY || has("--no-publish")) { console.log(`  ${edition.host} v${edition.version_id}: ${res.note || "draft built"} (${res.projectId})`); return; }
  // success: record the real listing under the writer's reservation, mail the writer
  await post("/api/listed", { signup_id: edition.signup_id, version_id: edition.version_id, listing_url: res.url, sig: hmac(`listed:${edition.signup_id}`) });
  console.log(`  ${edition.host} v${edition.version_id}: LISTED ${res.url}`);
}

export async function pass() {
  const limit = Math.min(Math.max(Number(arg("--limit")) || 10, 1), 50);
  const queue = await fetchQueue(limit);
  console.log(`${new Date().toISOString()} queue: ${queue.length} edition(s) waiting`);
  let listed = 0, failed = 0;
  for (const e of queue) {
    try { await listOne(e); listed++; }
    catch (err) {
      failed++;
      const stage = err instanceof LuluListingError ? err.stage : "?";
      console.error(`  ${e.host} v${e.version_id}: FAILED at ${stage}: ${err.message} — left at listing-pending for the hand-made fallback`);
      // surface the failure in the site UI without flipping the edition to a build failure
      try { await post("/api/press-status", { signup_id: e.signup_id, status: "listing-pending", version_id: e.version_id, version_status: "listing-pending", message: `automated listing failed at ${stage}; awaiting hand-made listing`, sig: hmac(`${e.signup_id}:listing-pending`) }); } catch {}
    }
  }
  return { listed, failed, total: queue.length };
}

// ---- run (only as a CLI, not when imported by a test) ----
if (import.meta.url === `file://${process.argv[1]}`) {
  if (has("--watch")) {
    const interval = Math.max(Number(arg("--interval")) || 300, 30) * 1000;
    console.log(`worker watching ${API} every ${interval / 1000}s${DRY ? " (dry-run)" : ""}`);
    for (;;) { try { await pass(); } catch (e) { console.error("pass error:", e.message); } await new Promise(r => setTimeout(r, interval)); }
  } else {
    const r = await pass();
    console.log(`done: ${r.listed} listed, ${r.failed} failed, of ${r.total}`);
    process.exit(r.failed && !r.listed ? 1 : 0);
  }
}
