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
import { createHmac } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { sendMail } from "./lib/mail.mjs";
import { proofKey, uploadProof, signedProofUrl } from "./lib/proof-store.mjs";

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
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"] }).toString();
const hmac = m => createHmac("sha256", SECRET).update(m).digest("hex");

async function status(st, extra = {}) {
  if (!SECRET) return log("status", `${st} (no secret, not reported)`);
  const r = await fetch(`${SITE}/api/press-status`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ signup_id: ID, status: st, sig: hmac(`${ID}:${st}`), run: process.env.GITHUB_RUN_ID || null, ...extra }) });
  log("status", `${st} -> ${r.status}`);
}

/* the volumes to build: the chosen route's, or one volume of the window when no plan carried */
const volumes = plan && Array.isArray(plan.volumes) && plan.volumes.length
  ? plan.volumes : [{ label: "The edition", subtitle: "", post_ids: null, est_pages: null }];
const interior = plan?.interior === "color" ? "color" : "bw";

function buildVolume(v, i, { proof }) {
  const base = `${slug}-${ID}-v${i + 1}`;
  const html = `proofs/${base}.html`, pdf = `${DIR}/${base}.pdf`;
  const args = ["scripts/build-book.mjs", host, "--out", html];
  if (!proof) args.push("--print-interior", "--images-print"); /* a proof keeps the smaller image path: the email link stays a quick download */
  if (interior === "bw") args.push("--interior-bw");
  if (v.post_ids && v.post_ids.length) { const f = `${DIR}/${base}.posts.json`; writeFileSync(f, JSON.stringify(v.post_ids)); args.push("--posts", f); }
  else if (plan?.window?.from) { args.push("--after", plan.window.from); if (plan.window.to) args.push("--before", plan.window.to); }
  if (existsSync("proofs/brand.json")) args.push("--brand-file", "proofs/brand.json");
  log("build", `${v.label}: ${args.slice(2).join(" ")}`);
  sh("node", args);
  const report = JSON.parse(readFileSync(html.replace(/\.html$/, ".report.json"), "utf-8"));
  sh("bash", ["scripts/render-book.sh", html, `${process.cwd()}/${pdf}`]);
  const pages = PDFDocument.load(readFileSync(pdf)).then(d => d.getPageCount());
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
  const built = [];
  for (let i = 0; i < volumes.length; i++) {
    const b = buildVolume(volumes[i], i, { proof: false });
    const pages = await b.pages;
    const key = proofKey(`${slug}-${ID}`, `interior-v${i + 1}`, b.pdf);
    await uploadProof(b.pdf, key);
    built.push({ label: volumes[i].label, pages, key, report: { included: b.report.included, listed: b.report.listed } });
    log("list", `${volumes[i].label}: ${pages} pages -> ${key}`);
  }
  writeFileSync(`${DIR}/list.json`, JSON.stringify({ id: ID, host, built, interior }, null, 1));
  await sendMail({ to: OPERATOR, subject: `press: files ready to list for ${host} (#${ID})`,
    text: `Reservation #${ID} approved.\n${URL_}\n${TO}\n\n` + built.map(b => `${b.label}: ${b.pages} pages, ${b.key}`).join("\n") +
      `\n\nNext: cover wrap + Lulu validation + listing (phase 3). Files are in the proof store for seven days.` });
  await status("listing", { message: `${built.length} volume(s) built` });
  console.log(`PRESS files built #${ID} ${host}: ${built.map(b => b.label + " " + b.pages + "pp").join(", ")}`);
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
