#!/usr/bin/env node
// One-command print pipeline: Substack URL -> Lulu-validated interior + cover, hosted and
// quoted, with an order command ready. Composes the proven pieces (build-book, render-book,
// cover-wrap, lulu-client) exactly as they were driven by hand for the caithrin edition
// (evidence/dogfood-order.md, evidence/lulu-store-publish.md).
//
//   node scripts/pipeline.mjs <url> [--slug name] [--window 12m|24m|all|YYYY-MM..YYYY-MM]
//     [--force <step>] [--quote-to addr.json] [--order addr.json --yes] [--no-model]
//
// Steps (each idempotent; state in proofs/pipe/<slug>/state.json):
//   probe -> copy -> build -> render -> sizegate -> cover -> host -> validate -> quote [-> order]
// The ONLY step that spends money is `order`, and it runs solely with --order AND --yes.
// Lulu calls run against production (the account keys are production-only; lulu-auth.md).

import { execFileSync, execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, statSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { makeClient, POD } from "./lulu-client.mjs";

const RAW = process.argv[2];
if (!RAW || RAW.startsWith("--")) { console.error("usage: pipeline.mjs <substack-url> [flags]"); process.exit(2); }
const argOf = f => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const host = new URL(RAW.includes("://") ? RAW : "https://" + RAW).hostname;
const SLUG = argOf("--slug") || host.replace(/^www\./, "").split(".")[0];
// The product promise is an annual or quarterly edition. An unbounded archive is opt-in.
const WINDOW = argOf("--window") || "12m";
const FORCE = argOf("--force");
const NO_MODEL = process.argv.includes("--no-model");
const DIR = `proofs/pipe/${SLUG}`;
mkdirSync(DIR, { recursive: true });

const MAX_UPLOAD = 9_500_000;      // stay under common 10MB gateway caps
const SIZE_TIERS = [[1000, 70], [900, 55], [800, 45]];  // px max, jpeg quality (proven 2026-08-28)
const UA = { "user-agent": "Mozilla/5.0 inksheaf-pipeline/1.0" };

const statePath = `${DIR}/state.json`;
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf-8")) : { steps: {} };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 1));
const ORDER = ["probe", "build", "copy", "render", "sizegate", "cover", "host", "validate", "quote"];
if (FORCE) for (const s of ORDER.slice(ORDER.indexOf(FORCE))) delete state.steps[s];
const done = s => state.steps[s]?.done;
const finish = (s, data = {}) => { state.steps[s] = { done: true, at: new Date().toISOString(), ...data }; save(); };
const log = (s, msg) => console.error(`[${s}] ${msg}`);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], ...opts }).toString();

/* ---------- probe: publication identity from Substack's own data, zero user input ---------- */
if (!done("probe")) {
  log("probe", host);
  const html = await (await fetch(`https://${host}`, { headers: UA, redirect: "follow" })).text();
  const m = html.match(/window\._preloads\s*=\s*JSON\.parse\("((?:[^"\\]|\\.)*)"\)/);
  const pub = m ? (JSON.parse(JSON.parse(`"${m[1]}"`)).pub || {}) : {};
  const arch = await (await fetch(`https://${host}/api/v1/archive?sort=new&offset=0&limit=25`, { headers: UA })).json();
  const newest = arch[0]?.post_date?.slice(0, 10);
  // window -> --after date
  let after = null;
  if (/^\d+m$/.test(WINDOW)) after = new Date(Date.now() - (+WINDOW.slice(0, -1)) * 30.44 * 86400e3).toISOString().slice(0, 10);
  const range = WINDOW.match(/^(\d{4}-\d{2})\.\.(\d{4}-\d{2})$/);
  const before = range ? range[2] + "-31" : null;
  if (range) after = range[1] + "-01";
  finish("probe", {
    pubName: pub.name || SLUG, heroText: pub.hero_text || pub.description || "",
    copyright: pub.copyright || "", coverPhoto: pub.cover_photo_url || null, logo: pub.logo_url || null,
    newest, after, before,
  });
}
const P = state.steps.probe;

/* ---------- brand ---------- */
const brandPath = `${DIR}/brand.json`;
if (!existsSync(brandPath)) {
  log("brand", "lifting theme");
  sh("node", ["scripts/brand-lift.mjs", host, "--out", brandPath]);
}

/* ---------- build ---------- */
// the HTML lives flat in proofs/ because build-book writes image srcs relative to proofs/
const interiorHtml = `proofs/${SLUG}-pipe.html`;
if (!done("build")) {
  log("build", `window=${WINDOW}`);
  const args = ["scripts/build-book.mjs", host, "--print-interior", "--images-print", "--interior-bw",
    "--brand-file", brandPath, "--out", interiorHtml];
  if (P.after) args.push("--after", P.after);
  if (P.before) args.push("--before", P.before);
  sh("node", args);
  const report = JSON.parse(readFileSync(interiorHtml.replace(/\.html$/, ".report.json"), "utf-8"));
  finish("build", { included: report.included, listed: report.listed, kind: report.kind,
    retrievalFailures: Number(report.retrievalFailures) || 0 });
}
const B = state.steps.build;

/* ---------- copy: cover + store text. Model writes it when available; template otherwise ---------- */
const copyPath = `${DIR}/copy.json`;
if (!done("copy") || !existsSync(copyPath)) {
  const noun = { letters: "Letters", recipes: "Recipes" }[B?.kind] || "Essays";
  // the true printed span comes from the build report (the posts actually included)
  const rep = JSON.parse(readFileSync(interiorHtml.replace(/\.html$/, ".report.json"), "utf-8"));
  const [d1, d2] = rep.dateRange || [P.after, P.newest];
  const mon = d => d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : "";
  const y = d => d?.slice(0, 4);
  const y1 = y(d1) || "", y2 = y(d2) || "";
  const years = y1 && y1 !== y2 ? `${y1}–${y2}` : y2;
  const datesLine = d1 && d2 ? `${mon(d1)} – ${mon(d2)}` : years;
  const count = B?.included ?? B?.listed ?? 0;
  const fallback = {
    kindLine: `Collected ${noun} · ${years}`,
    spineText: `${P.pubName} · Collected ${noun} · ${years}`,
    dates: datesLine, countLine: `${count} ${noun.toLowerCase()}`,
    blurb: "",
    desc: `${count} ${noun.toLowerCase()} from ${host.replace(/^www\./, "")}, printed in the order they first appeared.`,
    storeDescription: `The collected ${noun.toLowerCase()} of ${host.replace(/^www\./, "")}, drawn from the publication's archive and typeset as a trade paperback. Printed and sold at production cost. Produced with Inksheaf, which turns a Substack archive into a printed book.`,
  };
  let copy = fallback;
  if (!NO_MODEL) {
    try {
      const prompt = `Write back-cover and bookstore copy for a printed collection of a newsletter. Return ONLY JSON with keys blurb, desc, storeDescription. Rules: plain declarative sentences, no adjectives doing the work of facts, no hype, no em-dash chains. blurb: one short line in the author's spirit (may be empty string if nothing honest fits). desc: 2 sentences, back cover, what the reader is holding. storeDescription: 2-3 sentences for a store listing; must state it is printed and sold at production cost and produced with Inksheaf.\nPublication: ${P.pubName} (${host})\nAbout, in the author's own words: ${P.heroText?.slice(0, 400)}\nContents: ${count} ${noun.toLowerCase()}, ${datesLine}.`;
      const out = execFileSync("claude", ["-p", prompt, "--model", "haiku"], { stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 }).toString();
      const j = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
      copy = { ...fallback, ...Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === "string" && v.length < 600)) };
      log("copy", "model-written");
    } catch (e) { log("copy", "model unavailable, template used: " + String(e.message).slice(0, 80)); }
  }
  writeFileSync(copyPath, JSON.stringify({ pubName: P.pubName, host, ...copy }, null, 1));
  finish("copy", { model: copy !== fallback });
}

/* ---------- render ---------- */
const interiorPdf = `${DIR}/interior.pdf`;
if (!done("render")) {
  log("render", "Paged.js");
  const out = sh("bash", ["scripts/render-book.sh", interiorHtml, `${process.cwd()}/${interiorPdf}`]);
  const pages = +(out.match(/PAGES=(\d+)/)?.[1] || 0);
  if (!pages) throw new Error("render produced no page count: " + out.slice(0, 200));
  if (pages < 32 || pages > 800)
    throw new Error(`${pages}pp is outside perfect-bound limits (32-800); choose another binding or window`);
  finish("render", { pages, bytes: statSync(interiorPdf).size });
}
let PAGES = state.steps.render.pages;

/* ---------- sizegate: downscale images AT SOURCE and re-render; never gs-postprocess ---------- */
if (!done("sizegate")) {
  let bytes = statSync(interiorPdf).size;
  if (bytes <= MAX_UPLOAD) { log("sizegate", `${bytes}b ok`); finish("sizegate", { bytes, tier: null }); }
  else {
    const srcs = [...new Set([...readFileSync(interiorHtml, "utf-8").matchAll(/src="(\.cache\/[^"]+)"/g)].map(m => m[1]))];
    let applied = null;
    for (const [px, q] of SIZE_TIERS) {
      const cacheDir = `proofs/.cache/sized-${px}-${q}`;
      mkdirSync(cacheDir, { recursive: true });
      for (const rel of srcs) {
        const src = `proofs/${rel}`, dst = `${cacheDir}/${rel.split("/").pop()}`;
        if (!existsSync(dst)) {
          // macOS sips; on Linux swap for `magick <src> -resize ${px}x${px}> -quality ${q} <dst>`
          try { execFileSync("sips", ["-Z", String(px), "-s", "format", "jpeg", "-s", "formatOptions", String(q), src, "--out", dst], { stdio: "pipe" }); }
          catch { copyFileSync(src, dst); }
        }
      }
      const sizedHtml = `proofs/${SLUG}-pipe-sized.html`;
      writeFileSync(sizedHtml, readFileSync(interiorHtml, "utf-8")
        .replaceAll(/src="\.cache\/[^"]*\/([^"/]+)"/g, `src=".cache/sized-${px}-${q}/$1"`));
      const out = sh("bash", ["scripts/render-book.sh", sizedHtml, `${process.cwd()}/${interiorPdf}`]);
      const pages = +(out.match(/PAGES=(\d+)/)?.[1] || 0);
      if (pages !== PAGES) {
        // the raw render can flake on slow-loading original images; the SIZED artifact is what
        // ships, so the safety property is sized-render determinism (measured 2026-08-29:
        // sized 294/294 stable vs raw 293 flake)
        const out2 = sh("bash", ["scripts/render-book.sh", sizedHtml, `${process.cwd()}/${interiorPdf}`]);
        const pages2 = +(out2.match(/PAGES=(\d+)/)?.[1] || 0);
        if (pages2 !== pages) throw new Error(`sized render nondeterministic: ${pages} then ${pages2}`);
        console.error(`[sizegate] adopting stable sized page count ${pages} (raw render said ${PAGES})`);
        PAGES = pages;
        state.steps.render.pages = pages; save();
      }
      bytes = statSync(interiorPdf).size;
      log("sizegate", `tier ${px}px/q${q} -> ${bytes}b`);
      if (bytes <= MAX_UPLOAD) { applied = [px, q]; break; }
    }
    if (bytes > MAX_UPLOAD) throw new Error(`still ${bytes}b after all tiers; needs a human look`);
    finish("sizegate", { bytes, tier: applied });
  }
}

/* ---------- cover ---------- */
const lulu = makeClient({ production: true });
const coverPdf = `${DIR}/cover.pdf`;
if (!done("cover")) {
  const dims = await lulu.coverDimensions(PAGES);
  const W = +dims.width, H = +dims.height;
  log("cover", `${W}x${H}pt for ${PAGES}pp`);
  // plate: the publication's own cover photo when it has one
  let plate = null;
  if (P.coverPhoto) {
    plate = `${DIR}/plate.img`;
    if (!existsSync(plate)) {
      const r = await fetch(P.coverPhoto, { headers: UA });
      if (r.ok) writeFileSync(plate, Buffer.from(await r.arrayBuffer())); else plate = null;
    }
  }
  const coverHtml = `${DIR}/cover.html`;
  const args = ["scripts/cover-wrap.mjs", String(W), String(H), coverHtml];
  if (plate) args.push("plate.img");
  args.push("--meta", copyPath, "--brand", brandPath);
  sh("node", args);
  // flat render: fixed-geometry single page, no Paged.js. playwright-cli refuses file://,
  // so serve the pipe dir the same way render-book.sh serves the book.
  const port = 9100 + Math.floor(Math.random() * 400);
  const { spawn } = await import("node:child_process");
  const srv = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: DIR, stdio: "ignore" });
  try {
    await new Promise(r => setTimeout(r, 1000));
    sh("playwright-cli", ["open", "about:blank"]);
    const out = sh("playwright-cli", ["run-code", `async page => {
      await page.goto('http://127.0.0.1:${port}/cover.html', {waitUntil:'networkidle'});
      await page.waitForTimeout(1500);
      await page.pdf({ path: '${process.cwd()}/${coverPdf}', preferCSSPageSize: true, printBackground: true });
      return 'ok';
    }`]);
    if (!out.includes("ok")) throw new Error("cover render failed: " + out.slice(0, 200));
  } finally { srv.kill(); }
  finish("cover", { W, H, bytes: statSync(coverPdf).size });
}

/* ---------- host: hashed names on the public site (interim per R3; private bucket later) ---------- */
if (!done("host")) {
  const hash = f => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 12);
  const iName = `i-${hash(interiorPdf)}.pdf`, cName = `c-${hash(coverPdf)}.pdf`;
  copyFileSync(interiorPdf, `public/${iName}`);
  copyFileSync(coverPdf, `public/${cName}`);
  log("host", "deploying");
  execSync("npm run build >/dev/null 2>&1 && npx wrangler pages deploy dist --project-name inksheaf --commit-dirty=true >/dev/null 2>&1");
  const base = "https://inksheaf.pages.dev";
  for (const [name, file] of [[iName, interiorPdf], [cName, coverPdf]]) {
    // CF Pages omits content-length on HEAD; a 1-byte ranged GET returns the true size
    // in content-range ("bytes 0-0/TOTAL").
    let ok = false;
    for (let a = 0; a < 10 && !ok; a++) {
      await new Promise(r => setTimeout(r, 4000));
      const h = await fetch(`${base}/${name}`, { headers: { range: "bytes=0-0" } });
      const total = +(h.headers.get("content-range")?.split("/")[1] || h.headers.get("content-length") || 0);
      ok = h.ok && total === statSync(file).size;
    }
    if (!ok) throw new Error(`hosted ${name} does not match the local file`);
  }
  finish("host", { interiorUrl: `${base}/${iName}`, coverUrl: `${base}/${cName}` });
}
const H = state.steps.host;

/* ---------- validate: Lulu must say NORMALIZED before anything ships (R4) ---------- */
if (!done("validate")) {
  log("validate", "submitting both files");
  const vi = await lulu.validateInterior(H.interiorUrl);
  const vc = await lulu.validateCover(H.coverUrl, PAGES);
  const [ri, rc] = await Promise.all([
    lulu.pollValidation("interior", vi.id),
    lulu.pollValidation("cover", vc.id),
  ]);
  finish("validate", { interiorId: vi.id, coverId: vc.id, interior: ri.status, cover: rc.status });
  log("validate", `interior ${ri.status}, cover ${rc.status}`);
}

/* ---------- quote ---------- */
// reference quote address lives OUTSIDE source control (public repo; audit finding P2-20).
// Provide ~/.secrets/inksheaf-ref-address.json or pass --quote-to explicitly.
const REF_ADDR_PATH = `${process.env.HOME}/.secrets/inksheaf-ref-address.json`;
const REF_ADDR = existsSync(REF_ADDR_PATH) ? JSON.parse(readFileSync(REF_ADDR_PATH, "utf-8"))
  : { city: "San Francisco", country_code: "US", postcode: "94103", state_code: "CA",
      street1: "1 Market St", phone_number: "+1 415 555 0100", name: "Inksheaf Reference" };
if (!done("quote")) {
  const addr = argOf("--quote-to") ? JSON.parse(readFileSync(argOf("--quote-to"), "utf-8")) : REF_ADDR;
  const q = await lulu.costQuote(PAGES, addr);
  finish("quote", {
    print: q.line_item_costs?.[0]?.cost_excl_discounts, shipping: q.shipping_cost?.total_cost_excl_tax,
    total_excl_tax: q.total_cost_excl_tax, total_incl_tax: q.total_cost_incl_tax, currency: q.currency,
  });
}

/* ---------- manifest ---------- */
const manifest = {
  slug: SLUG, host, pod: POD, pages: PAGES, window: WINDOW,
  kind: B.kind, articles: B.listed,
  interior: { pdf: interiorPdf, url: H.interiorUrl, bytes: state.steps.sizegate.bytes, sizedTier: state.steps.sizegate.tier },
  cover: { pdf: coverPdf, url: H.coverUrl },
  validation: state.steps.validate,
  quote: state.steps.quote,
  order_command: `node scripts/pipeline.mjs ${host} --slug ${SLUG} --order <address.json> --yes`,
};
writeFileSync(`${DIR}/manifest.json`, JSON.stringify(manifest, null, 1));
console.log(JSON.stringify(manifest, null, 1));

/* ---------- order: REAL MONEY; both flags required ---------- */
const orderAddr = argOf("--order");
if (orderAddr) {
  if (done("order")) {
    console.error(`[order] NOT placed again; state already records Lulu job ${state.steps.order.jobId}.`);
    console.error("Use a new slug or explicitly clear order state only after reviewing the existing job.");
    process.exit(0);
  }
  if (!process.argv.includes("--yes")) {
    console.error(`\nOrder NOT placed. Quote: ${state.steps.quote.total_incl_tax} ${state.steps.quote.currency} landed.`);
    console.error("Re-run with --yes to charge the saved wallet and print.");
    process.exit(3);
  }
  const addr = JSON.parse(readFileSync(orderAddr, "utf-8"));
  const externalId = `inksheaf-${SLUG}-${createHash("sha1").update(JSON.stringify(addr) + WINDOW).digest("hex").slice(0, 10)}`;
  const job = await lulu.createPrintJob({
    externalId, title: `${P.pubName} — Collected ${B.kind === "letters" ? "Letters" : B.kind === "recipes" ? "Recipes" : "Essays"}`,
    pages: PAGES, interiorUrl: H.interiorUrl, coverUrl: H.coverUrl, address: addr,
  });
  state.steps.order = { done: true, jobId: job.id, status: job.status?.name, externalId, at: new Date().toISOString() };
  save();
  console.error(`[order] job ${job.id} ${job.status?.name} external_id=${externalId}`);
}
