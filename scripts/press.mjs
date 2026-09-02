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

async function status(st, extra = {}) {
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
  await status("building");
  const v = volumes[0];
  const b = buildVolume(v, 0, { proof: true });
  const pages = await b.pages;
  const key = proofKey(`${slug}-${ID}`, "proof", b.pdf);
  await uploadProof(b.pdf, key);
  const proofUrl = signedProofUrl(key, 7 * 24 * 3600);
  const first = await firstPages(b.pdf, 12);
  const approve = `${SITE}/api/approve?id=${ID}&sig=${hmac(`approve:${ID}`)}`;
  const change = `${SITE}/change?id=${ID}&sig=${hmac(`change:${ID}`)}`;
  const n = volumes.length;
  const shape = n > 1 ? `${n} volumes (${volumes.map(x => x.label).join(", ")})` : `one volume of about ${pages} pages`;
  const text = `${plan?.sentences?.proof_email_opening || "Here are the first pages of your edition."}

Attached: the first ${Math.min(12, pages)} pages of ${v.label}${n > 1 ? ", the first volume" : ""}: half-title, title page, contents, and the opening piece. The whole proof (${pages} pages, watermarked) is here for seven days:
${proofUrl}

The plan you chose: ${shape}, ${interior === "bw" ? "black and white" : "colour"} interior, 6×9, perfect bound, at cost.

If it reads right, approve it and we send it to the printer:
${approve}

Want to change something first (leave posts out, retitle, switch to a different set, add a dedication)?
${change}

Nothing prints until you approve. Reply to this email and a person answers.

Inksheaf`;
  await sendMail({ to: TO, subject: `Your proof: ${b.report.pubName || host}`, text,
    attachments: [{ filename: `${slug}-first-pages.pdf`, content: first }] });
  await sendMail({ to: OPERATOR, subject: `press: proof sent for ${host} (#${ID})`,
    text: `Reservation #${ID}\n${URL_}\n${TO}\nroute ${plan?.cadence || "none"}, ${n} volume(s), ${interior}\nfirst volume ${pages} pages\nproof ${proofUrl}\nrun ${process.env.GITHUB_RUN_ID || "local"}` });
  await status("proofed", { proof_key: key, message: `${pages} pages, ${n} volume(s)` });
  writeFileSync(`${DIR}/press.json`, JSON.stringify({ id: ID, host, pages, key, volumes: n, interior }, null, 1));
  console.log(`PRESS proofed #${ID} ${host}: ${pages} pages, ${n} volume(s), proof ${key}`);
} else if (EVENT === "list") {
  await status("listing");
  const lulu = process.env.LULU_CLIENT_KEY ? makeClient({ production: true }) : null;
  const built = [];
  for (let i = 0; i < volumes.length; i++) {
    const v = volumes[i];
    const b = buildVolume(v, i, { proof: false });
    const pages = await b.pages;
    const base = `${slug}-${ID}-v${i + 1}`;
    const iKey = proofKey(`${slug}-${ID}`, `interior-v${i + 1}`, b.pdf);
    await uploadProof(b.pdf, iKey);
    const row = { label: v.label, pages, interiorKey: iKey, report: { included: b.report.included, listed: b.report.listed } };
    if (lulu) {
      /* cover: Lulu's wrap dimensions for this page count, the plan's words on it */
      const dims = await lulu.coverDimensions(pages, POD_ID);
      const W = +dims.width, H = +dims.height;
      const pubName = b.report.pubName || host;
      const kind = (plan?.kind || "essays");
      const meta = { pubName, host, kindLine: `${v.title && v.title !== pubName ? v.title + " · " : ""}${v.label}`,
        spineText: `${pubName} · ${v.label}`, dates: v.subtitle || v.label, countLine: `${b.report.included} ${kind}`,
        blurb: "", desc: `${b.report.included} ${kind} from ${host.replace(/^www\./, "")}, ${v.subtitle || v.label}, printed in the order they first appeared.` };
      const metaPath = `${DIR}/${base}.cover.json`; writeFileSync(metaPath, JSON.stringify(meta));
      const coverHtml = `${DIR}/${base}.cover.html`, coverPdf = `${DIR}/${base}.cover.pdf`;
      const cargs = ["scripts/cover-wrap.mjs", String(W), String(H), coverHtml, "--meta", metaPath];
      if (existsSync(brandPath)) cargs.push("--brand", brandPath);
      sh("node", cargs);
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.goto(`file://${process.cwd()}/${coverHtml}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(1500);
        await page.pdf({ path: coverPdf, preferCSSPageSize: true, printBackground: true });
      } finally { await browser.close(); }
      const cKey = proofKey(`${slug}-${ID}`, `cover-v${i + 1}`, coverPdf);
      await uploadProof(coverPdf, cKey);
      const vi = await lulu.validateInterior(signedProofUrl(iKey), POD_ID);
      const vc = await lulu.validateCover(signedProofUrl(cKey), pages, POD_ID);
      const [ri, rc] = await Promise.all([lulu.pollValidation("interior", vi.id), lulu.pollValidation("cover", vc.id)]);
      Object.assign(row, { coverKey: cKey, cover: { W, H }, validation: { interior: ri.status, cover: rc.status, interiorId: vi.id, coverId: vc.id } });
      log("list", `${v.label}: ${pages} pages, interior ${ri.status}, cover ${rc.status}`);
    } else log("list", `${v.label}: ${pages} pages -> ${iKey} (no Lulu key: cover and validation skipped)`);
    built.push(row);
  }
  writeFileSync(`${DIR}/list.json`, JSON.stringify({ id: ID, host, built, interior }, null, 1));
  const allValid = lulu && built.every(b => b.validation && b.validation.interior === "NORMALIZED" && b.validation.cover === "NORMALIZED");
  await sendMail({ to: OPERATOR, subject: `press: ${allValid ? "files validated, ready to list" : "files built"} for ${host} (#${ID})`,
    text: `Reservation #${ID} approved.\n${URL_}\n${TO}\n\n` + built.map(b => `${b.label}: ${b.pages} pages, interior ${b.interiorKey}` + (b.coverKey ? `, cover ${b.coverKey}, validation ${b.validation.interior}/${b.validation.cover}` : "")).join("\n") +
      `\n\nNext: the Lulu listing (wizard). Files are in the proof store for seven days.` });
  await status(allValid ? "validated" : "listing", { message: `${built.length} volume(s) built${allValid ? ", all NORMALIZED" : ""}`,
    files: built.map(b => ({ label: b.label, pages: b.pages, interiorKey: b.interiorKey, coverKey: b.coverKey || null, validated: !!(b.validation && b.validation.interior === "NORMALIZED" && b.validation.cover === "NORMALIZED") })) });
  console.log(`PRESS ${allValid ? "validated" : "built"} #${ID} ${host}: ${built.map(b => b.label + " " + b.pages + "pp").join(", ")}`);
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
