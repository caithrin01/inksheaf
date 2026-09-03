#!/usr/bin/env node
// Unit test for the Lulu listing driver (no network). Exercises the manifest -> operation sequence
// in dry-run, checks every GraphQL string is well-formed, and checks the fail-safe surfaces errors
// instead of continuing. The live shapes (RevenueGoalInput, FileUploadInput) are confirmed by the
// operator's first --login run; this suite is the precondition, not the verdict.
process.argv.push("--dry-run"); // DRY is read at import time
const { listEdition, LuluListingError } = await import("./lulu-gql.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.error("FAIL:", m); } };

const manifest = {
  id: 7, host: "weijinresearch.substack.com", version_id: 3,
  category: "LITERARY COLLECTIONS", keywords: ["ai", "china"],
  payee: { firstName: "Test", lastName: "Payee", currency: "USD", paymentType: "CHECK" },
  built: [{ label: "2025–2026", pubName: "Weijin Research", pages: 148, interiorKey: "k/int", coverKey: "k/cov" }],
};
const readAsset = async () => Buffer.alloc(0);

// 1. full publish sequence
const res = await listEdition(manifest, { publish: true, readAsset });
const names = res.steps.map(s => s.name);
const expect = ["createProject", "setStartStepDetails", "updateTitleAndEdition", "updateContributors", "interior", "spec", "cover", "details", "revenueGoal", "createPayee", "revenueShares", "publish", "selectAccess", "url"];
ok(res.ok, "dry publish returns ok");
ok(JSON.stringify(names) === JSON.stringify(expect), "step order matches expected: " + names.join(","));
ok(names.indexOf("interior") < names.indexOf("spec"), "interior uploaded before spec (drives page count)");
ok(names.indexOf("publish") < names.indexOf("selectAccess"), "publish before Select Access");

// 2. no-publish stops before publishing
const draft = await listEdition(manifest, { publish: false, readAsset });
ok(!draft.steps.some(s => s.name === "publish"), "--no-publish does not publish");
ok(draft.steps.some(s => s.name === "cover"), "--no-publish still builds the full draft");

// 3. reuse an existing payee id instead of creating one
const withPayee = await listEdition({ ...manifest, payeeId: "pay_1", payee: undefined }, { publish: false, readAsset });
ok(!withPayee.steps.some(s => s.name === "createPayee"), "given payeeId, no payee is created");
ok(withPayee.steps.some(s => s.name === "revenueShares"), "given payeeId, revenue share is still set");

// 4. every GraphQL op string is balanced and typed
const { readFileSync } = await import("node:fs");
const src = readFileSync(new URL("./lulu-gql.mjs", import.meta.url), "utf-8");
const ops = [...src.matchAll(/^\s*(\w+):\s*`(mutation|query)([^`]*)`/gm)];
ok(ops.length >= 15, `found ${ops.length} operation strings`);
for (const [, name, , body] of ops) {
  const s = "(" + body; // ignore
  const bal = t => { let n = 0; for (const c of t) { if (c === "{" || c === "(") n++; else if (c === "}" || c === ")") n--; if (n < 0) return false; } return n === 0; };
  ok(bal(body), `op ${name}: braces/parens balanced`);
}

// 5. fail-safe: an asset read error is thrown, not swallowed
let threw = null;
try { await listEdition(manifest, { publish: true, readAsset: async () => { throw new LuluListingError("asset", "proof fetch failed"); } }); }
catch (e) { threw = e; }
ok(threw instanceof LuluListingError, "asset failure throws LuluListingError");
ok(threw && threw.stage === "asset", "error carries the failing stage");

console.log(`lulu-gql: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
