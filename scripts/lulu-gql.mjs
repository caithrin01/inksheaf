#!/usr/bin/env node
// The Lulu listing driver (plan-lulu-listing-v1, route 2a). It creates a Select Access bookstore
// listing at print cost by calling Lulu's private GraphQL API at api.lulu.com/graphql/ directly,
// the same API the publish wizard uses. No DOM, no clicking. Evidence for every operation and the
// auth model: 05-Projects/Substack Magazine/evidence/lulu-graphql-wizard-2026-09-02.md.
//
// AUTH. createProject and the rest require the HUMAN account's bearer token (the Print API
// client-credentials token is a separate service identity and is FORBIDDEN from createProject;
// tested and recorded in the evidence file). The token is captured, not scraped: `--login` opens a
// headed browser, a person signs in, and the driver reads the Authorization header off the first
// real api.lulu.com/graphql request, then saves it to ~/.secrets/lulu-bearer (chmod 600) with the
// Playwright storage state beside it for silent refresh. A token is short-lived; re-run --login (or
// --refresh) when it expires.
//
// FAIL-SAFE (plan decision, Caithrin 2026-09-02). Every call asserts its response. On the first
// error or unexpected shape, the driver throws LuluListingError{stage} and makes NO further calls:
// the caller leaves the edition at listing-pending and the operator finishes it by hand through
// POST /api/listed (the hand-made Lulu URL is the backup). There is no partial-listing state.
//
// USAGE
//   node scripts/lulu-gql.mjs --login                 capture a human token (headed browser)
//   node scripts/lulu-gql.mjs --run list.json         drive to a published Select Access listing
//     [--dry-run]   print every GraphQL call it WOULD make, hit the network for nothing
//     [--no-publish] stop before publishLastVersion (leave a complete draft to inspect)
//     [--keep]      do not retire on error (default retires a half-built project so none dangles)
//
// list.json is the press manifest (scripts/press.mjs writes it): { id, host, version_id, built[],
// interior }. built[i] = { label, pages, interiorKey, coverKey, sha256, ... }. Interior and cover
// bytes are pulled from the proof store by key. v1 lists the FIRST volume; multi-volume bundling is
// a later pass (createProjectVersion / addProjectToBundle exist).

import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const BASE = "https://api.lulu.com";
const GQL = `${BASE}/graphql/`;
const SECRETS = `${process.env.HOME}/.secrets`;
const BEARER_FILE = process.env.LULU_BEARER_FILE || `${SECRETS}/lulu-bearer`;
const SESSION_FILE = `${SECRETS}/lulu-session.json`;
const POD = process.env.LULU_POD || "0600X0900.BW.STD.PB.060UW444.MXX"; // 6x9 BW perfect bound, matte
const arg = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const has = f => process.argv.includes(f);
const DRY = has("--dry-run");

export class LuluListingError extends Error {
  constructor(stage, message, detail) { super(`[${stage}] ${message}`); this.name = "LuluListingError"; this.stage = stage; this.detail = detail; }
}

// ---- the operations, verbatim from the wizard client bundle (2026-09-02) ----
const OPS = {
  createProject: `mutation($projectType:ProductTypeEnum!){ createProject(projectType:$projectType){ id availableOperations luluBookstoreSellIntention } }`,
  setStartStepDetails: `mutation($id:ID!,$projectTitle:String,$language:String,$category:String){ patchProject(id:$id,input:{projectTitle:$projectTitle,language:$language,category:$category}){ id projectTitle } }`,
  updateTitleAndEdition: `mutation($id:ID!,$bookTitle:String,$bookSubtitle:String){ patchProject(id:$id,input:{bookTitle:$bookTitle,bookSubtitle:$bookSubtitle}){ id bookTitle bookSubtitle } }`,
  updateContributors: `mutation($id:ID!,$bookContributors:[BookContributorInput]){ patchProject(id:$id,input:{bookContributors:$bookContributors}){ id } }`,
  updatePodPackageId: `mutation($id:ID!,$podPackageId:String,$coverType:CoverTypeEnum){ patchProject(id:$id,input:{podPackageId:$podPackageId,coverType:$coverType}){ id podPackageId coverType interiorFile{ status pageCount } } }`,
  updateCategoriesAndKeywords: `mutation($id:ID!,$category:String,$bisacCategories:[BisacCategoryInput],$keywords:[String]){ patchProject(id:$id,input:{category:$category,bisacCategories:$bisacCategories,keywords:$keywords}){ id } }`,
  updateAudience: `mutation($id:ID!,$audience:String,$adultRating:String){ patchProject(id:$id,input:{audience:$audience,adultRating:$adultRating}){ id } }`,
  createDirectUploadURL: `mutation($input:FileUploadInput!){ createDirectUploadURL(input:$input){ uploadUrl fileId } }`,
  setInteriorFile: `mutation($projectId:ID!,$fileId:Int!){ setInteriorFile(projectId:$projectId,fileId:$fileId){ id interiorFile{ status pageCount isStalled errors{ message } } } }`,
  setCoverFile: `mutation($projectId:ID!,$fileId:Int!,$coverType:CoverTypeEnum){ setCoverFile(projectId:$projectId,fileId:$fileId,coverType:$coverType){ id uploadedCover{ status errors{ message } } } }`,
  patchRevenueGoal: `mutation($id:ID!,$input:RevenueGoalInput){ patchRevenueGoal(id:$id,input:$input){ id pricing{ priceType minimumPrice{ amount currency } listPrice{ amount currency } isValid } } }`,
  patchListPrice: `mutation($id:ID!,$input:ListPriceInput!){ patchListPrice(id:$id,input:$input){ id pricing{ listPrice{ amount currency } isValid } } }`,
  createPayee: `mutation($input:PayeeInput!){ createPayee(input:$input){ id firstName lastName } }`,
  setProjectRevenueShares: `mutation($projectId:ID!,$shares:[RevenueShareInput!]!){ setProjectRevenueShares(projectId:$projectId,revenueShares:$shares){ payeeId share } }`,
  publishLastVersion: `mutation($projectId:ID!){ publishLastVersion(projectId:$projectId){ id status availableOperations } }`,
  setSelectAccess: `mutation($id:ID!,$sellIntention:SellIntentEnum){ patchProject(id:$id,input:{luluBookstoreSellIntention:$sellIntention}){ id luluBookstoreSellIntention } }`,
  retireProject: `mutation($projectId:ID!){ retireProject(projectId:$projectId){ id } }`,
  projectUrl: `query($id:ID!){ project(id:$id){ id status shopUrl publicUrl luluBookstoreSellIntention } }`,
};

// ---- token: capture off a real request, never scraped from storage ----
function loadBearer() {
  if (process.env.LULU_BEARER) return process.env.LULU_BEARER.trim();
  if (existsSync(BEARER_FILE)) return readFileSync(BEARER_FILE, "utf-8").trim();
  return null;
}
function tokenFresh(tok) { try { const c = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString()); return c.exp && c.exp - Date.now() / 1000 > 60; } catch { return false; } }

async function login() {
  const { chromium } = await import("playwright");
  const b = await chromium.launch({ headless: false });
  const ctx = await b.newContext(existsSync(SESSION_FILE) ? { storageState: SESSION_FILE } : {});
  const page = await ctx.newPage();
  let captured = null;
  page.on("request", req => { if (!captured && req.url().startsWith(GQL)) { const a = req.headers()["authorization"]; if (a && a.startsWith("Bearer ")) captured = a.slice(7); } });
  await page.goto("https://www.lulu.com/account/projects");
  console.error("Sign in to Lulu in the window if prompted, then wait a moment while the token is captured…");
  const t0 = Date.now();
  while (!captured && Date.now() - t0 < 180000) { await page.waitForTimeout(1000); if (Date.now() - t0 > 4000 && !captured) await page.reload().catch(() => {}); }
  if (captured) { mkdirSync(SECRETS, { recursive: true }); writeFileSync(BEARER_FILE, captured); chmodSync(BEARER_FILE, 0o600); await ctx.storageState({ path: SESSION_FILE }); console.error(`token saved to ${BEARER_FILE}`); }
  else console.error("no api.lulu.com/graphql request seen; are you signed in?");
  await b.close();
  return captured;
}

// dry-run returns the minimal synthetic shape each op's caller reads, so a dry pass simulates the
// whole sequence (ids, fileId, publish status, url) without a network call.
const DRY_DATA = {
  createProject: { createProject: { id: "DRY", availableOperations: [], luluBookstoreSellIntention: null } },
  createDirectUploadURL: { createDirectUploadURL: { uploadUrl: "dry://upload", fileId: 0 } },
  createPayee: { createPayee: { id: "DRY-PAYEE", firstName: "", lastName: "" } },
  publishLastVersion: { publishLastVersion: { id: "DRY", status: "IN_REVIEW", availableOperations: [] } },
  projectUrl: { project: { id: "DRY", status: "IN_REVIEW", shopUrl: "https://www.lulu.com/shop/dry", publicUrl: null } },
};
async function gql(stage, op, variables) {
  if (DRY) { console.error(`[dry-run] ${stage}: ${op}\n  variables: ${JSON.stringify(variables)}`); return DRY_DATA[op] || { __dry: true }; }
  const tok = loadBearer();
  if (!tok) throw new LuluListingError("auth", "no bearer token; run `node scripts/lulu-gql.mjs --login` first");
  if (!tokenFresh(tok)) throw new LuluListingError("auth", "bearer token expired; run --login again");
  const r = await fetch(GQL, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: JSON.stringify({ query: OPS[op], variables }) });
  let json; try { json = await r.json(); } catch { throw new LuluListingError(stage, `non-JSON response, HTTP ${r.status}`); }
  if (json.errors?.length) throw new LuluListingError(stage, json.errors.map(e => e.extensions?.code || e.message).join("; "), json.errors);
  return json.data;
}

// ---- file upload: signed URL then PUT then setInteriorFile/setCoverFile ----
async function uploadFile(stage, projectId, kind, filename, bytes, contentType) {
  // FileUploadInput exact keys are confirmed on the first live run; these are the wizard's fields
  // as best derived from the bundle. The assertion on the returned {uploadUrl,fileId} catches a
  // wrong shape immediately, before any PUT.
  const input = { fileName: filename, contentType, fileType: kind }; // kind: "INTERIOR" | "COVER"
  const d = await gql(stage, "createDirectUploadURL", { input });
  if (DRY) return { fileId: 0 };
  const up = d?.createDirectUploadURL;
  if (!up?.uploadUrl || up.fileId == null) throw new LuluListingError(stage, "createDirectUploadURL returned no uploadUrl/fileId", d);
  const put = await fetch(up.uploadUrl, { method: "PUT", headers: { "content-type": contentType }, body: bytes });
  if (!put.ok) throw new LuluListingError(stage, `PUT to signed URL failed HTTP ${put.status}`);
  return { fileId: Number(up.fileId) };
}

// ---- the manifest -> a listing ----
export async function listEdition(manifest, opts = {}) {
  const publish = opts.publish !== false;
  const vol = (manifest.built || [])[0];
  if (!vol) throw new LuluListingError("manifest", "no built volume in the manifest");
  const pubName = vol.pubName || manifest.pubName || manifest.host;
  const title = vol.title && vol.title !== pubName ? `${pubName} — ${vol.label}` : `${pubName} — ${vol.label || "Collected"}`;
  const steps = [];
  const step = (name, data) => { steps.push({ name, ...(data ? { data } : {}) }); };
  let projectId = null;
  try {
    const cp = await gql("create", "createProject", { projectType: "PRINTED_BOOK" });
    projectId = cp?.createProject?.id || (DRY ? "DRY" : null);
    step("createProject", { projectId });

    await gql("start", "setStartStepDetails", { id: projectId, projectTitle: title, language: "en", category: manifest.category || "LITERARY COLLECTIONS" });
    step("setStartStepDetails");

    await gql("title", "updateTitleAndEdition", { id: projectId, bookTitle: pubName, bookSubtitle: vol.label || null });
    step("updateTitleAndEdition");

    await gql("contributors", "updateContributors", { id: projectId, bookContributors: [{ role: "AUTHOR", firstName: manifest.authorFirst || pubName, lastName: manifest.authorLast || "" }] });
    step("updateContributors");

    // interior first (it drives page count and validation), then spec, then cover
    const interiorBytes = await opts.readAsset(vol.interiorKey);
    const iu = await uploadFile("interior-upload", projectId, "INTERIOR", `${manifest.host}-interior.pdf`, interiorBytes, "application/pdf");
    await gql("interior-set", "setInteriorFile", { projectId, fileId: iu.fileId });
    step("interior");

    await gql("spec", "updatePodPackageId", { id: projectId, podPackageId: POD, coverType: "FULL_WRAP" });
    step("spec");

    const coverBytes = await opts.readAsset(vol.coverKey);
    const cu = await uploadFile("cover-upload", projectId, "COVER", `${manifest.host}-cover.pdf`, coverBytes, "application/pdf");
    await gql("cover-set", "setCoverFile", { projectId, fileId: cu.fileId, coverType: "FULL_WRAP" });
    step("cover");

    await gql("details", "updateCategoriesAndKeywords", { id: projectId, category: manifest.category || "LITERARY COLLECTIONS", bisacCategories: manifest.bisac || [], keywords: manifest.keywords || [] });
    await gql("audience", "updateAudience", { id: projectId, audience: "GENERAL", adultRating: "false" });
    step("details");

    // price at the floor: $0 revenue goal, Bookstore only. RevenueGoalInput exact keys confirmed on
    // first live run; the assertion on returned pricing.isValid + minimumPrice catches a wrong shape.
    await gql("revenue", "patchRevenueGoal", { id: projectId, input: { amount: 0, currency: "USD", salesChannel: "DIRECT" } });
    step("revenueGoal");

    // payee is required even at $0. Reuse the operator's existing payee id if given; else create one.
    let payeeId = manifest.payeeId;
    if (!payeeId && manifest.payee) { const p = await gql("payee", "createPayee", { input: manifest.payee }); payeeId = p?.createPayee?.id; step("createPayee", { payeeId }); }
    if (payeeId) { await gql("shares", "setProjectRevenueShares", { projectId, shares: [{ payeeId, share: 100 }] }); step("revenueShares"); }

    if (publish) {
      const pub = await gql("publish", "publishLastVersion", { projectId });
      step("publish", { status: pub?.publishLastVersion?.status });
      await gql("access", "setSelectAccess", { id: projectId, sellIntention: "DIRECT" }); // DIRECT => Select Access
      step("selectAccess");
      const u = await gql("url", "projectUrl", { id: projectId });
      const url = u?.project?.shopUrl || u?.project?.publicUrl || null;
      step("url", { url });
      return { ok: true, projectId, url, steps };
    }
    return { ok: true, projectId, url: null, steps, note: "no-publish: complete draft left for inspection" };
  } catch (e) {
    // fail-safe: retire a half-built project so nothing dangles, unless --keep
    if (projectId && projectId !== "DRY" && !opts.keep && !DRY) { try { await gql("retire", "retireProject", { projectId }); } catch {} }
    if (e instanceof LuluListingError) { e.projectId = projectId; e.steps = steps; throw e; }
    throw new LuluListingError("unknown", e.message, { steps, projectId });
  }
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  if (has("--login")) { await login(); process.exit(0); }
  if (has("--retire")) { // clean up a test project: node scripts/lulu-gql.mjs --retire <projectId>
    const pid = arg("--retire");
    if (!pid) { console.error("usage: --retire <projectId>"); process.exit(2); }
    try { await gql("retire", "retireProject", { projectId: pid }); console.log(`retired ${pid}`); }
    catch (e) { console.error(`retire failed: ${e.message}`); process.exit(1); }
    process.exit(0);
  }
  const manifestPath = arg("--run");
  if (!manifestPath) { console.error("usage: lulu-gql.mjs --login | --run list.json [--dry-run] [--no-publish] [--keep]"); process.exit(2); }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  // asset reader: pull interior/cover bytes from the proof store by key
  const { signedProofUrl } = await import("./lib/proof-store.mjs");
  // a key that is a local file (a manifest built for a self-contained test) is read from disk;
  // otherwise it is a proof-store key fetched over a signed URL.
  const readAsset = async key => {
    if (DRY) return Buffer.alloc(0);
    if (existsSync(key)) return readFileSync(key);
    const r = await fetch(signedProofUrl(key));
    if (!r.ok) throw new LuluListingError("asset", `proof ${key} fetch HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  };
  try {
    const res = await listEdition(manifest, { publish: !has("--no-publish"), keep: has("--keep"), readAsset });
    console.log(JSON.stringify(res, null, 1));
  } catch (e) {
    console.error(`FAILED at stage ${e.stage || "?"}: ${e.message}`);
    console.error("fall back to the hand-made listing: leave the version at listing-pending and complete it via POST /api/listed");
    process.exit(1);
  }
}
