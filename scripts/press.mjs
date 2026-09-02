#!/usr/bin/env node
// The press. Runs in GitHub Actions (press.yml) after a reservation (event "press") or an
// approval (event "list"). Reuses the proven pieces: build-book (with the plan's exact post
// list), render-book.sh, the proof store, lulu-client. Every email goes to one address.
//
//   press: build the first volume of the chosen route as a watermarked proof, slice its first
//          pages, store both privately, email the writer the pages + proof link + approve link,
//          email the operator one line, report status "proofed".
//   list:  build every volume as a print interior (no watermark), validate with Lulu, store,
//          report status "listing" with the keys; the listing itself is phase 3.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fit } from "./lib/fit.mjs";
import { createHash } from "node:crypto";
import { printCost } from "../functions/lib/editor-input.js";
import { createHmac } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { sendMail } from "./lib/mail.mjs";
import { proofKey, uploadProof, signedProofUrl } from "./lib/proof-store.mjs";
import { makeClient } from "./lulu-client.mjs";
import prices from "../functions/lib/print-prices.json" with { type: "json" };
import { chromium } from "playwright";

const EVENT = process.env.PRESS_EVENT || "press";
const ID = Number(process.env.SIGNUP_ID);
const URL_ = process.env.PUBLICATION_URL || "";
const TO = process.env.WRITER_EMAIL || "";
const OPERATOR = process.env.OPERATOR_EMAIL || "caithrin@caithrin.com";
const SITE = (process.env.SITE_BASE || "https://inksheaf.com").replace(/\/$/, "");
const SECRET = process.env.ARCHIVE_RELAY_TOKEN || "";
const host = URL_.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
if (!ID || !host || !TO) { console.error("SIGNUP_ID, PUBLICATION_URL and WRITER_EMAIL are required"); process.exit(2); }
let plan = null; try { plan = JSON.parse(process.env.PLAN_JSON || "null"); } catch { plan = null; }
const slug = host.replace(/\W+/g, "-");
const DIR = `proofs/press/${ID}`; mkdirSync(DIR, { recursive: true });
const log = (s, m) => console.error(`[${s}] ${m}`);
/* a failing command must leave its own words in the log, not just node's stack */
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"] }).toString(); }
  catch (e) { const out = e.stdout ? e.stdout.toString().trim() : ""; if (out) console.error(out.split("\n").slice(-12).join("\n")); throw new Error(`${cmd} ${args.slice(0, 2).join(" ")} failed (exit ${e.status})`); } };
const hmac = m => createHmac("sha256", SECRET).update(m).digest("hex");

let STAGE = "start";
/* a crash anywhere becomes a truthful "failed" row with the stage and run id, never "building" */
for (const ev of ["uncaughtException", "unhandledRejection"]) process.on(ev, async (err) => {
  const msg = String((err && err.message) || err).replace(/[\r\n]+/g, " ").slice(0, 200);
  console.error(`PRESS FAILED at ${STAGE}: ${msg}`);
  try { await status("failed", { message: `failed at ${STAGE}: ${msg}`, error: msg, run: process.env.GITHUB_RUN_ID || "local", version_id: Number(process.env.VERSION_ID) || undefined, version_status: process.env.VERSION_ID ? "failed" : undefined }); } catch {}
  try { await sendMail({ to: OPERATOR, subject: `press: FAILED at ${STAGE} for ${host} (#${ID})`, text: `Reservation #${ID}\n${URL_}\n${TO}\nstage ${STAGE}\nrun ${process.env.GITHUB_RUN_ID || "local"}\n\n${msg}` }); } catch {}
  process.exit(1);
});
async function status(st, extra = {}) {
  STAGE = st;
  if (!SECRET) return log("status", `${st} (no secret, not reported)`);
  /* a status report that fails must never stop the press; the email is the deliverable */
  try {
    const r = await fetch(`${SITE}/api/press-status`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ signup_id: ID, status: st, sig: hmac(`${ID}:${st}`), run: process.env.GITHUB_RUN_ID || null, ...extra }) });
    log("status", `${st} -> ${r.status}`);
  } catch (e) { log("status", `${st} not reported: ${String(e.message || e).slice(0, 80)}`); }
}

/* the volumes to build: the chosen route's, or one volume of the window when no plan carried */
const volumes = plan && Array.isArray(plan.volumes) && plan.volumes.length
  ? plan.volumes : [{ label: "The edition", subtitle: "", post_ids: null, est_pages: null }];
const ROMAN_N = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];
const interior = plan?.interior === "color" ? "color" : "bw";
const POD_ID = prices.pods[interior].pod_package_id; // 6x9 perfect bound, black-and-white or full colour

/* the publication's own palette for the cover and the title page */
const brandPath = `${DIR}/brand.json`;
if (!existsSync(brandPath)) { try { sh("node", ["scripts/brand-lift.mjs", host, "--out", brandPath]); } catch (e) { log("brand", "lift failed, default brand: " + String(e.message).slice(0, 80)); } }


/* the short links a volume prints go to the site's links table so inksheaf.com/l/<code> answers;
   a failure here is logged, never fatal: the codes derive from the targets and can be re-registered */
async function registerLinks(report) {
  const rows = [...(report.links || []).map(l => ({ code: l.code, target: l.target, kind: "link", slug: l.slug, letter: l.letter })),
    ...(report.essayLinks || []).map(l => ({ code: l.code, target: l.target, kind: "essay", slug: l.slug, letter: "" }))];
  if (!rows.length || !SECRET) return;
  const r = await fetch(`${SITE}/api/links`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ signup_id: ID, sig: hmac(`links:${ID}`), links: rows }) });
  const j = await r.json().catch(() => ({}));
  log("links", `${rows.length} rows -> ${r.status}${j.registered != null ? `, ${j.registered} registered` : ""}`);
}

/* start another press run from inside a run (a new proof after articles changed); never fatal */
async function dispatchOrLog(payload) {
  const token = process.env.GITHUB_DISPATCH_TOKEN; if (!token) return log("dispatch", "no token; a person starts the new proof");
  try { const r = await fetch("https://api.github.com/repos/caithrin01/inksheaf/dispatches", { method: "POST", headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "inksheaf-press/1.0" }, body: JSON.stringify({ event_type: payload.event, client_payload: payload }) }); log("dispatch", `${payload.event} -> ${r.status}`); }
  catch (e) { log("dispatch", `failed: ${String(e.message).slice(0, 80)}`); }
}
function buildVolume(v, i, { proof }) {
  const base = `${slug}-${ID}-v${i + 1}`;
  const html = `proofs/${base}.html`, pdf = `${DIR}/${base}.pdf`;
  const args = ["scripts/build-book.mjs", host, "--out", html];
  if (!proof) args.push("--print-interior", "--images-print"); /* a proof keeps the smaller image path: the email link stays a quick download */
  if (interior === "bw") args.push("--interior-bw");
  if (v.post_ids && v.post_ids.length) { const f = `${DIR}/${base}.posts.json`; writeFileSync(f, JSON.stringify(v.post_ids)); args.push("--posts", f); }
  else if (plan?.window?.from) { args.push("--after", plan.window.from); if (plan.window.to) args.push("--before", plan.window.to); }
  if (existsSync(brandPath)) args.push("--brand-file", brandPath);
  if (plan?.dedication && i === 0) args.push("--dedication", String(plan.dedication).slice(0, 300));
  /* a writer's own ISBN (one per volume, plan.isbn or plan.isbns[i]): copyright page and back-cover barcode */
  const isbn = (Array.isArray(plan?.isbns) ? plan.isbns[i] : null) || (volumes.length === 1 ? plan?.isbn : null);
  if (isbn) args.push("--isbn", String(isbn).slice(0, 20));
  if (Array.isArray(plan?.include) && plan.include.length) args.push("--include", plan.include.map(x => String(x).replace(/[^a-z0-9-]/gi, "")).filter(Boolean).join(","));
  if (v.label && v.label !== "The edition") { args.push("--vol-label", v.label); if (volumes.length > 1) args.push("--vol-of", `${ROMAN_N[i] || i + 1} of ${ROMAN_N[volumes.length - 1] || volumes.length}`); }
  log("build", `${v.label}: ${args.slice(2).join(" ")}`);
  const fitted = fit({ args, html, pdf: `${process.cwd()}/${pdf}`, log: m => log("fit", `${v.label}: ${m}`) });
  for (const line of String(fitted.out || "").split("\n").filter(l => /^(BLANK|TAIL|OK )/.test(l))) log("render", `${v.label}: ${line}`); /* the measure lines belong in the run log */
  const report = JSON.parse(readFileSync(html.replace(/\.html$/, ".report.json"), "utf-8"));
  report.fit = { pass: fitted.pass, deferred: fitted.defer };
  registerLinks(report).catch(e => log("links", `not registered: ${String(e.message).slice(0, 80)}`));
  const pages = PDFDocument.load(readFileSync(pdf)).then(d => d.getPageCount());
  if (report.planSelection && report.planSelection.missing && report.planSelection.missing.length) log("build", `${v.label}: ${report.planSelection.missing.length} planned post(s) not in the archive listing: ${report.planSelection.missing.slice(0, 5).join(", ")}`);
  return { html, pdf, report, pages };
}

async function firstPages(pdfPath, n = 12) {
  const src = await PDFDocument.load(readFileSync(pdfPath));
  const out = await PDFDocument.create();
  const idx = [...Array(Math.min(n, src.getPageCount())).keys()];
  const copied = await out.copyPages(src, idx);
  copied.forEach(p => out.addPage(p));
  return Buffer.from(await out.save());
}

if (EVENT === "press") {
  /* The proof is the print file (Codex audit P0-1, P1-7): every volume is built once at final
     resolution, uploaded, hashed, and recorded as one edition version. The writer reads the
     exact bytes that will print; approval names the version and its digest. */
  await status("building");
  const vols = [];
  const postOrder = [], bodyHashes = {};
  for (let i = 0; i < volumes.length; i++) {
    const v = volumes[i];
    const b = buildVolume(v, i, { proof: false });
    const pages = await b.pages;
    const key = proofKey(`${slug}-${ID}`, `interior-v${i + 1}`, b.pdf);
    await uploadProof(b.pdf, key);
    const sha = createHash("sha256").update(readFileSync(b.pdf)).digest("hex");
    for (const o of (b.report.postOrder || [])) postOrder.push(o);
    Object.assign(bodyHashes, b.report.bodyHashes || {});
    vols.push({ label: v.label, title: v.title || null, subtitle: v.subtitle || null, pages, key, sha256: sha, included: b.report.included, pubName: b.report.pubName || host, kind: plan?.kind || "essays", postOrder: b.report.postOrder || [],
      leftOut: [...(b.report.ruleCuts || []).map(c => ({ slug: c.slug, title: c.title, reason: c.reason, kind: "rule" })), ...(b.report.guestCuts || []).map(g => ({ slug: g.slug, title: g.title, reason: `a guest post by ${g.by}`, kind: "guest" }))],
      pdf: b.pdf, report: b.report });
    log("press", `${v.label}: ${pages} pages, ${key}, sha256 ${sha.slice(0, 12)}`);
  }
  const totalPages = vols.reduce((n, x) => n + x.pages, 0);
  const rendererSha = process.env.GITHUB_SHA || (() => { try { return sh("git", ["rev-parse", "HEAD"]).trim(); } catch { return "local"; } })();
  const vr = await fetch(`${SITE}/api/version`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    signup_id: ID, sig: hmac(`version:${ID}`), plan_json: plan || {}, post_ids: postOrder, body_hashes: bodyHashes, renderer_sha: rendererSha, print_mode: interior,
    volumes: vols.map(x => ({ label: x.label, title: x.title, subtitle: x.subtitle, pages: x.pages, key: x.key, sha256: x.sha256, included: x.included, pubName: x.pubName, kind: x.kind, postOrder: x.postOrder, leftOut: x.leftOut })),
    proof_key: vols[0].key, proof_sha256: vols[0].sha256, pages: totalPages, run_id: process.env.GITHUB_RUN_ID || "" }) });
  const vj = await vr.json().catch(() => ({}));
  if (!vr.ok || !vj.ok) throw new Error(`version not recorded: ${vr.status} ${JSON.stringify(vj).slice(0, 160)}`);
  const versionId = vj.version_id, nonce = vj.nonce;
  const first = await firstPages(vols[0].pdf, 12);
  const proofUrl = signedProofUrl(vols[0].key, 7 * 24 * 3600);
  const approve = `${SITE}/api/approve?v=${versionId}&n=${nonce}`;
  const change = `${SITE}/change?id=${ID}&sig=${hmac(`change:${ID}`)}`;
  const n = volumes.length;
  const cost = vols.reduce((t, x) => t + printCost(x.pages, interior), 0);
  const shape = n > 1 ? `${n} volumes (${vols.map(x => `${x.label}, ${x.pages} pages`).join("; ")})` : `one volume of ${totalPages} pages`;
  const text = `${plan?.sentences?.proof_email_opening || "Here is your edition, exactly as it will print."}

Attached: the first ${Math.min(12, vols[0].pages)} pages of ${vols[0].label}${n > 1 ? ", the first volume" : ""}: half-title, title page, contents, and the opening piece. The whole file (${shape}) is here for seven days:
${proofUrl}
${n > 1 ? vols.slice(1).map(x => `${x.label}: ${signedProofUrl(x.key, 7 * 24 * 3600)}`).join("\n") + "\n" : ""}
This is the file that prints. Print cost at Lulu for this edition: $${cost.toFixed(2)} per copy before shipping, at cost, nothing added. ${plan?.est_pages && Math.abs(totalPages - plan.est_pages) / totalPages > 0.15 ? `(The plan page estimated ${plan.est_pages} pages; the typeset book is ${totalPages}. The price above is for the real book.) ` : ""}

If it reads right, approve it here; the page shows the version, the pages and the price, and asks once:
${approve}

Want to change something first (leave posts out, bring one back, retitle, switch to a different set, add a dedication or an ISBN)?
${change}

Nothing prints until you approve. Reply to this email and a person answers.

Inksheaf`;
  await sendMail({ to: TO, subject: `Your proof: ${vols[0].pubName || host}`, text,
    attachments: [{ filename: `${slug}-first-pages.pdf`, content: first }] });
  await sendMail({ to: OPERATOR, subject: `press: proof sent for ${host} (#${ID}, version ${versionId})`,
    text: `Reservation #${ID}\n${URL_}\n${TO}\nroute ${plan?.cadence || "none"}, ${n} volume(s), ${interior}\nversion ${versionId}, ${totalPages} pages, print cost $${cost.toFixed(2)}, renderer ${rendererSha.slice(0, 12)}\n` + vols.map(x => `${x.label}: ${x.pages} pages, ${x.key}, ${x.sha256.slice(0, 12)}`).join("\n") + `\nproof ${proofUrl}\nrun ${process.env.GITHUB_RUN_ID || "local"}\n` });
  const leftOut = vols.flatMap(x => x.leftOut);
  await status("proofed", { proof_key: vols[0].key, message: `version ${versionId}: ${totalPages} pages, ${n} volume(s)`, left_out: leftOut, version_id: versionId });
  writeFileSync(`${DIR}/press.json`, JSON.stringify({ id: ID, host, pages: totalPages, key: vols[0].key, volumes: n, interior, version_id: versionId }, null, 1));
  console.log(`PRESS proofed #${ID} ${host}: version ${versionId}, ${totalPages} pages, ${n} volume(s), proof ${vols[0].key}`);
} else if (EVENT === "list") {
  /* The final run for one approved version (Codex audit P0-1, P0-4): no rebuild. The approved
     interiors are fetched back from the proof store and checked against the version's digests;
     the archive is read again and each body hashed against the version; a difference stops the
     run and asks for a new proof. Only the covers are made here. Then Lulu validates, the
     version becomes "validated", and the writer gets the ready email with the mailing link.
     The Lulu bookstore listing is a separate, optional, hand-made step (listing-pending). */
  const VERSION_ID = Number(process.env.VERSION_ID || 0);
  if (!VERSION_ID) throw new Error("list event without a version id");
  const vres = await fetch(`${SITE}/api/version?id=${VERSION_ID}&sig=${hmac(`version:${ID}`)}`);
  const vjson = await vres.json().catch(() => ({}));
  if (!vres.ok || !vjson.ok) throw new Error(`version ${VERSION_ID} not readable: ${vres.status}`);
  const ver = vjson.version;
  if (ver.status !== "approved") throw new Error(`version ${VERSION_ID} is ${ver.status}, not approved`);
  await status("building-final", { version_id: VERSION_ID });
  const vvols = JSON.parse(ver.volumes || "[]"), hashes = JSON.parse(ver.body_hashes || "{}");
  /* the bodies, as they are now, against the version */
  const changed = [];
  for (const o of JSON.parse(ver.post_ids || "[]")) {
    const slugOf = typeof o === "object" ? o.slug : null; const id = typeof o === "object" ? o.id : o;
    if (!slugOf) continue;
    try { const f = await (await fetch(`https://${host}/api/v1/posts/${slugOf}`, { headers: { "user-agent": "inksheaf-press/1.0" } })).json();
      const h = createHash("sha256").update(String(f.body_html || "")).digest("hex");
      if (hashes[String(id)] && hashes[String(id)] !== h) changed.push(slugOf); } catch { /* unreadable now: the approved bytes still print */ }
  }
  if (changed.length) {
    await status("failed", { version_id: VERSION_ID, message: `${changed.length} article(s) changed since the proof: ${changed.slice(0, 5).join(", ")}`, version_status: "failed", error: "articles changed since the proof" });
    await sendMail({ to: TO, subject: `Your edition needs a new proof: ${vvols[0]?.pubName || host}`, text: `Since you approved the proof, ${changed.length === 1 ? "one article" : changed.length + " articles"} changed on ${host.replace(/^www\./, "")}: ${changed.slice(0, 5).join(", ")}.\n\nWe do not print a file you have not read, so a fresh proof is on its way to this inbox. Approve that one when it reads right.\n\nInksheaf` });
    await dispatchOrLog({ event: "press", signup_id: ID, publication_url: URL_, email: TO, plan_json: ver.plan_json });
    console.log(`PRESS stopped #${ID}: ${changed.length} article(s) changed since version ${VERSION_ID}`);
  } else {
  const lulu = process.env.LULU_CLIENT_KEY ? makeClient({ production: true }) : null;
  const built = [];
  for (let i = 0; i < vvols.length; i++) {
    const v = vvols[i];
    const base = `${slug}-${ID}-v${i + 1}`;
    const pdf = `${DIR}/${base}.pdf`;
    const r = await fetch(signedProofUrl(v.key)); if (!r.ok) throw new Error(`interior ${v.key} not in the proof store (${r.status})`);
    writeFileSync(pdf, Buffer.from(await r.arrayBuffer()));
    const sha = createHash("sha256").update(readFileSync(pdf)).digest("hex");
    if (sha !== v.sha256) throw new Error(`interior ${v.key} digest ${sha.slice(0, 12)} differs from the approved ${String(v.sha256).slice(0, 12)}`);
    const pages = v.pages;
    const row = { label: v.label, pages, interiorKey: v.key, sha256: sha, report: { included: v.included } };
    if (lulu) {
      const dims = await lulu.coverDimensions(pages, POD_ID);
      const W = +dims.width, H = +dims.height;
      const pubName = v.pubName || host;
      const kind = v.kind || "essays";
      const meta = { pubName, host, kindLine: `${v.title && v.title !== pubName ? v.title + " · " : ""}${v.label}`,
        spineText: `${pubName} · ${v.label}`, dates: v.subtitle || v.label, countLine: `${v.included} ${kind}`,
        blurb: "", desc: `${v.included} ${kind} from ${host.replace(/^www\./, "")}, ${v.subtitle || v.label}, printed in the order they first appeared.` };
      const metaPath = `${DIR}/${base}.cover.json`; writeFileSync(metaPath, JSON.stringify(meta));
      const coverHtml = `${DIR}/${base}.cover.html`, coverPdf = `${DIR}/${base}.cover.pdf`;
      const cargs = ["scripts/cover-wrap.mjs", String(W), String(H), coverHtml, "--meta", metaPath];
      let planNow = null; try { planNow = JSON.parse(ver.plan_json || "null"); } catch {}
      const isbn = (Array.isArray(planNow?.isbns) ? planNow.isbns[i] : null) || (vvols.length === 1 ? planNow?.isbn : null);
      if (isbn) cargs.push("--isbn", String(isbn));
      if (existsSync(brandPath)) cargs.push("--brand", brandPath);
      sh("node", cargs);
      const browser = await chromium.launch();
      try { const page = await browser.newPage(); await page.goto(`file://${process.cwd()}/${coverHtml}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500); await page.pdf({ path: coverPdf, preferCSSPageSize: true, printBackground: true }); }
      finally { await browser.close(); }
      const cKey = proofKey(`${slug}-${ID}`, `cover-v${i + 1}`, coverPdf);
      await uploadProof(coverPdf, cKey);
      const vi = await lulu.validateInterior(signedProofUrl(v.key), POD_ID);
      const vc = await lulu.validateCover(signedProofUrl(cKey), pages, POD_ID);
      const [ri, rc] = await Promise.all([lulu.pollValidation("interior", vi.id), lulu.pollValidation("cover", vc.id)]);
      Object.assign(row, { coverKey: cKey, cover: { W, H }, validation: { interior: ri.status, cover: rc.status, interiorId: vi.id, coverId: vc.id } });
      log("list", `${v.label}: ${pages} pages, interior ${ri.status}, cover ${rc.status}`);
    } else log("list", `${v.label}: ${pages} pages (no Lulu key: cover and validation skipped)`);
    built.push(row);
  }
  writeFileSync(`${DIR}/list.json`, JSON.stringify({ id: ID, host, version_id: VERSION_ID, built, interior }, null, 1));
  const allValid = lulu && built.every(b => b.validation && b.validation.interior === "NORMALIZED" && b.validation.cover === "NORMALIZED");
  const cost = built.reduce((t, x) => t + printCost(x.pages, interior), 0);
  const quote = { print_cost: Math.round(cost * 100) / 100, volumes: built.map(b => ({ label: b.label, pages: b.pages })), interior, measured: new Date().toISOString() };
  const files = built.map(b => ({ label: b.label, pages: b.pages, interiorKey: b.interiorKey, coverKey: b.coverKey || null, validated: !!(b.validation && b.validation.interior === "NORMALIZED" && b.validation.cover === "NORMALIZED") }));
  if (allValid) {
    await sendMail({ to: TO, subject: `Your book passed the printer's checks: ${vvols[0]?.pubName || host}`, text: `The printer's checks passed for version ${VERSION_ID}: ${built.map(b => `${b.label}, ${b.pages} pages`).join("; ")}, ${interior === "color" ? "colour" : "black and white"} interior. Print cost at Lulu: $${cost.toFixed(2)} per copy, at cost; Lulu adds its own shipping at checkout.

Next, a person at Inksheaf sets up the book's page at Lulu, where you and your readers order copies; that takes up to one working day. You will get one more email with the link, a short link and QR code you can print or post, and a ready-made button for your Substack.

Inksheaf` });
    await sendMail({ to: OPERATOR, subject: `press: version ${VERSION_ID} validated, LISTING NEEDED (#${ID})`, text: `Reservation #${ID}\n${URL_}\n${TO}\n\n` + built.map(b => `${b.label}: ${b.pages} pages, interior ${b.interiorKey}, cover ${b.coverKey}, ${b.validation.interior}/${b.validation.cover}`).join("\n") + `\n\nPrint cost $${cost.toFixed(2)} (list price = print cost). Make the Lulu listing from these files (proof store, seven days), then record it:\nPOST ${SITE}/api/listed {signup_id: ${ID}, version_id: ${VERSION_ID}, listing_url, sig: hmac("listed:${ID}")}` });
    await status("listing-pending", { version_id: VERSION_ID, message: `${built.length} volume(s), all NORMALIZED, print cost $${cost.toFixed(2)}; listing by hand`, files, version_status: "listing-pending", quote });
  } else {
    await sendMail({ to: OPERATOR, subject: `press: version ${VERSION_ID} files built, validation incomplete (#${ID})`, text: `Reservation #${ID}\n${URL_}\n${TO}\n\n` + built.map(b => `${b.label}: ${b.pages} pages, ${b.interiorKey}` + (b.validation ? `, ${b.validation.interior}/${b.validation.cover}` : ", not validated")).join("\n") });
    await status("failed", { version_id: VERSION_ID, message: `${built.length} volume(s) built, validation incomplete`, files, version_status: "failed", error: "Lulu validation incomplete" });
  }
  console.log(`PRESS ${allValid ? "validated" : "built"} #${ID} ${host}: version ${VERSION_ID}, ${built.map(b => b.label + " " + b.pages + "pp").join(", ")}`);
  }
} else if (EVENT === "invoice") {
  /* no Stripe on this deploy: the invoice goes by email and a person confirms payment */
  const inv = JSON.parse(process.env.INVOICE_JSON || "{}");
  const lines = (inv.quotes || []).map(x => `${x.name}, ${x.city} ${x.state}: ${x.quantity} × ${volumes.length === 1 ? "copy" : "set"}, $${Number(x.total).toFixed(2)}`).join("\n");
  const t = inv.totals || {};
  const text = `Invoice for mailing #${process.env.MAILING_ID} of ${host}\n\n${lines}\n\nPrinting: $${Number(t.print).toFixed(2)}\nShipping (${String(inv.level || "").toLowerCase().replace("_", " ")}): $${Number(t.shipping).toFixed(2)}\n${t.tax != null ? `Tax: $${Number(t.tax).toFixed(2)}\n` : ""}Total, at cost: $${Number(t.total).toFixed(2)}${t.estimated ? " (estimated from the measured cost table; the printer's exact figure follows)" : ""}\n\nNothing is marked up; this is what the printer charges. Reply to this email to pay by the method that suits you, and the parcels print as soon as it lands. You get one email per parcel with its tracking number.\n\nInksheaf`;
  await sendMail({ to: TO, subject: `Invoice: ${t.copies} ${volumes.length === 1 ? "copies" : "sets"} of ${host}, $${Number(t.total).toFixed(2)} at cost`, text });
  await sendMail({ to: OPERATOR, subject: `press: invoice #${process.env.MAILING_ID} for ${host} (#${ID}), $${Number(t.total).toFixed(2)}`, text: `${URL_}\n${TO}\n\n${text}\n\nWhen paid: workflow_dispatch press with event mail and this mailing id.` });
  await status("invoiced", { message: `mailing ${process.env.MAILING_ID}: $${Number(t.total).toFixed(2)}` });
  console.log(`PRESS invoice sent #${ID} mailing ${process.env.MAILING_ID}`);
} else if (EVENT === "mail") {
  /* REAL MONEY: one Lulu print job per address, only for a paid mailing, only from validated files */
  const lulu = makeClient({ production: true });
  const addresses = JSON.parse(process.env.ADDRESSES_JSON || "[]");
  let files = null; try { files = (JSON.parse(process.env.FILES_JSON || "null") || {}).files || null; } catch {}
  if (!files || !files.length || !files.every(f => f.validated && f.interiorKey && f.coverKey)) { console.error("no validated files for this edition; mailing not placed"); await status("mail-blocked", { message: "no validated files" }); process.exit(3); }
  if (!addresses.length) { console.error("no addresses"); process.exit(2); }
  const level = process.env.LEVEL || "MAIL";
  const placed = [];
  for (let i = 0; i < addresses.length; i++) {
    const a = addresses[i];
    const address = { name: a.name, street1: a.street1, street2: a.street2 || undefined, city: a.city, state_code: a.state_code, postcode: a.postcode, country_code: "US", phone_number: a.phone || "+1 415 555 0100" };
    const externalId = `inksheaf-${ID}-m${process.env.MAILING_ID}-${i + 1}`;
    try {
      const job = await lulu.api("/print-jobs/", { external_id: externalId, contact_email: OPERATOR, shipping_level: level, shipping_address: address,
        line_items: files.map(f => ({ external_id: `${externalId}-${f.label.replace(/\W+/g, "-")}`, title: `${host} · ${f.label}`, quantity: Number(a.quantity) || 1,
          printable_normalization: { pod_package_id: POD_ID, interior: { source_url: signedProofUrl(f.interiorKey, 24 * 3600) }, cover: { source_url: signedProofUrl(f.coverKey, 24 * 3600) } } })) });
      placed.push({ address: `${a.name}, ${a.city} ${a.state_code}`, jobId: job.id, status: job.status?.name });
      log("mail", `${externalId}: job ${job.id} ${job.status?.name}`);
    } catch (e) { placed.push({ address: `${a.name}, ${a.city} ${a.state_code}`, error: String(e.message).slice(0, 200) }); log("mail", `${externalId} FAILED: ${String(e.message).slice(0, 120)}`); }
  }
  writeFileSync(`${DIR}/mail-${process.env.MAILING_ID}.json`, JSON.stringify({ id: ID, mailing: process.env.MAILING_ID, placed }, null, 1));
  const okN = placed.filter(p => p.jobId).length;
  await sendMail({ to: TO, subject: `Printing: ${okN} of ${placed.length} parcels of ${host} are with the printer`,
    text: `Your mailing is with the printer.\n\n` + placed.map(p => `${p.address}: ${p.jobId ? "print job " + p.jobId : "not placed (" + p.error + "); a person is on it"}`).join("\n") + `\n\nYou get one email per parcel with its tracking number when it ships.\n\nInksheaf` });
  await sendMail({ to: OPERATOR, subject: `press: ${okN}/${placed.length} print jobs placed for ${host} mailing #${process.env.MAILING_ID}`, text: JSON.stringify(placed, null, 1) });
  await status(okN === placed.length ? "printing" : "mail-partial", { message: `${okN}/${placed.length} jobs placed`, jobs: placed });
  console.log(`PRESS mail #${ID} mailing ${process.env.MAILING_ID}: ${okN}/${placed.length} jobs placed`);
} else if (EVENT === "change") {
  const req = process.env.CHANGE_REQUEST || "(empty)";
  await sendMail({ to: OPERATOR, subject: `press: change requested for ${host} (#${ID})`,
    text: `Reservation #${ID}\n${URL_}\n${TO}\n\nThe writer asks:\n\n${req}\n\nApply it, re-proof (workflow_dispatch press with the same id), and the new proof email goes out.` });
  await sendMail({ to: TO, subject: `Got your changes: ${host}`,
    text: `Thanks. A person applies these now and emails you the new proof pages, usually the same day:\n\n${req}\n\nNothing prints until you approve.\n\nInksheaf` });
  await status("change-requested", { message: req.slice(0, 200) });
  console.log(`PRESS change recorded #${ID} ${host}`);
} else {
  console.error(`unknown event ${EVENT}`); process.exit(2);
}
