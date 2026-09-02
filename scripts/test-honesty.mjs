#!/usr/bin/env node
// Durable honesty gate: every number and claim on the deployed page traced to its
// measured source, plus the reachable-state contradictions the 2026-09-01 audit named.
// Run: node scripts/test-honesty.mjs [base-url | --source-only]
//   --source-only reads dist/index.html and skips the live API checks (pre-deploy gate).
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const sourceOnly = process.argv[2] === "--source-only";
const base = (sourceOnly ? "" : (process.argv[2] || "https://inksheaf.com")).replace(/\/$/, "");
const html = sourceOnly
  ? readFileSync(new URL("../dist/index.html", import.meta.url), "utf8")
  : await (await fetch(base + "/")).text();
/* the page's client script is a separate bundle: read every /_astro/*.js the page references */
const bundlePaths = [...html.matchAll(/src="(\/_astro\/[^"]+\.js)"/g)].map(m => m[1]);
const js = sourceOnly
  ? bundlePaths.map(p => readFileSync(new URL("../dist" + p, import.meta.url), "utf8")).join("\n")
  : (await Promise.all(bundlePaths.map(p => fetch(base + p).then(r => r.text())))).join("\n");
const astroSrc = readFileSync(new URL("../src/pages/index.astro", import.meta.url), "utf8");
const prices = JSON.parse(readFileSync(new URL("../functions/lib/print-prices.json", import.meta.url), "utf8"));
let n = 0;
const ok = (name, cond, detail = "") => { n++; assert.ok(cond, name + (detail ? " :: " + detail : "")); console.log("PASS " + name); };

/* measured numbers appear, and match the source file, not just themselves */
ok("bw curve reproduces the $9.34 order", Math.abs(prices.pods.bw.base + prices.pods.bw.per_page * 294 - 9.34) < 0.01);
ok("$9.34 on page", html.includes("$9.34"));
ok("$16.58 on page", html.includes("$16.58"));
ok("spec bw price matches curve at 200pp", html.includes("$" + (prices.pods.bw.base + prices.pods.bw.per_page * 200).toFixed(2)));
ok("spec color price matches measured point", html.includes("$10.83"));
ok("shipping base on page matches source", html.includes(prices.shipping_mail.toFixed(2)));
/* the shipping fit is labeled for what it is: measured points exist for 1/2/4/8 */
for (const k of ["1","2","4","8"]) ok("shipping point " + k + " measured", typeof prices.shipping_by_volumes[k] === "number");

/* The Object section quotes the caithrin edition; its counts and span come from the
   pipeline's manifest and copy files, and the span is stated because the preview's
   twelve-month read of the same site gives a smaller book (28 essays on 2026-09-01). */
const manifest = JSON.parse(readFileSync(new URL("../proofs/pipe/caithrin/manifest.json", import.meta.url), "utf8"));
const editionCopy = JSON.parse(readFileSync(new URL("../proofs/pipe/caithrin/copy.json", import.meta.url), "utf8"));
ok("edition essay count matches the manifest", html.includes(`edition: ${manifest.articles} essays`));
ok("edition page count matches the manifest", html.includes(`${manifest.pages} pages at 6×9`));
ok("edition span on page matches the cover copy", editionCopy.dates === "January 2025 – August 2026" && /40 essays from January 2025\s+to August 2026/.test(html));

/* policy consistency: the page's binding cap agrees with the engine's */
const summarySrc = readFileSync(new URL("../functions/lib/preview-summary.js", import.meta.url), "utf8");
ok("engine cap is 300", summarySrc.includes("> 300"));
ok("page states the 300 cap", /300[- ]page/.test(html));
ok("pipeline hard limit is 800", readFileSync(new URL("../scripts/pipeline.mjs", import.meta.url), "utf8").includes("pages > 800"));
ok("page states the 800 refusal (D5)", /refuse any past (the bindery&rsquo;s limit of |the bindery’s limit of )?800/.test(html));
ok("builder warns between 300 and 800 (D5)", readFileSync(new URL("../scripts/build-book.mjs", import.meta.url), "utf8").includes("over the recommended 300pp"));

/* capped reads and fitted shipping are labelled as estimates (audit gates 3 and 4) */
ok("page references its client bundle", bundlePaths.length >= 1);
ok("full-year claim is gone", !js.includes("covers the full year") && !astroSrc.includes("covers the full year"));
ok("capped sentence in client bundle", js.includes("estimates until we read the rest"));
ok("unmeasured shipping says about (source)", astroSrc.includes("'about $' + Math.round(ship)"));
ok("shipping is exact only at measured set sizes (source)", astroSrc.includes("Object.keys(PRICES.shipping_set || {}).map(Number).includes(n) && !d.capped"));
ok("shipping 8-point is from the sweep", readFileSync(new URL("../scripts/quote-sweep.mjs", import.meta.url), "utf8").includes("[1, 2, 4, 8]"));

/* labels promise what the click does (audit gate 6, decision D2 2026-09-01) */
ok("big button reserves, does not start", html.includes(">Reserve this print run<") && !html.includes("Start the print run"));
ok("reply card confirms a reservation", html.includes("Your print run is reserved."));
ok("snippet offers a preview until an edition is live", js.includes("Preview a print edition of ") && !js.includes("Get a print copy of "));

/* time budget: server relay retries finish inside 40s, the page gives up at 45s (1.6) */
const apiSrc = readFileSync(new URL("../functions/api/preview.js", import.meta.url), "utf8");
ok("relay budget is 40s", apiSrc.includes("RELAY_BUDGET_MS = 40000"));
ok("client abort is 45s, after the server budget", astroSrc.includes("ctl.abort(), 45000"));
ok("abort shows the hand-built offer", astroSrc.includes("taking too long to read. Send it below"));

/* Astro's compressor drops a line break between a word and an inline tag, gluing
   "choice:caithrin" and "oncaithrin.com" together (found on production 2026-09-01, same
   class as the noscript bug A13 caught). Refuse any letter or punctuation flush against
   an opening <a>, or a closing </a> flush against a letter. */
const glued = [...html.matchAll(/[A-Za-z:;,.]<a\s[^>]*>|<\/a>(?:[A-Za-z]|&(?:middot|mdash|ndash|bull);)/g)].map(m => m[0].slice(0, 30));
ok("no text glued to a link by the compressor", glued.length === 0, glued.join(" | "));

/* contact + attribution */
ok("no dead hello@ anywhere in page", !html.includes("hello@inksheaf.com"));
ok("contact is caithrin@", html.includes("caithrin@caithrin.com"));
ok("substack non-affiliation", html.includes("not affiliated"));
ok("og domain canonical", html.includes('content="https://inksheaf.com/og.png"'));

/* voice lint (launch-hardening 2.2): the visible copy, the client bundle's strings, and
   the CSS. Exclamation marks, marketing words and any affiliation construction are refused;
   the caithrin personal brand and Substack's marks stay out of the Inksheaf tree. */
const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, "")
  .replace(/<[^>]+>/g, " ").replace(/&[a-z]+;|&#\d+;/g, " ");
const jsStrings = [...js.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(m => m[2]).join("\n");
const copy = visible + "\n" + jsStrings;
ok("no exclamation marks in visible copy or client strings", !/!/.test(copy));
for (const phrase of ["high-quality", "join thousands", "beautiful", "treasure"])
  ok(`voice: no "${phrase}"`, !new RegExp(phrase, "i").test(copy));
const affiliations = [...copy.matchAll(/(partner(ed|ship)?\s+with\s+Substack|official\s+Substack|Substack['’]s\s+print|by\s+Substack\b|endorsed\s+by\s+Substack|Substack\s*(\+|and|x)\s*Inksheaf|Inksheaf\s*(\+|and|x)\s*Substack)/gi)]
  .filter(m => !/not affiliated with or endorsed by Substack/i.test(copy.slice(Math.max(0, m.index - 40), m.index + 40)));
ok("voice: no affiliation construction (the disclaimer's negation is the one allowed form)", affiliations.length === 0, affiliations.map(m => m[0]).join(", "));
const cssPaths = [...html.matchAll(/href="(\/_astro\/[^"]+\.css)"/g)].map(m => m[1]);
const css = sourceOnly
  ? cssPaths.map(p => readFileSync(new URL("../dist" + p, import.meta.url), "utf8")).join("\n")
  : (await Promise.all(cssPaths.map(p => fetch(base + p).then(r => r.text())))).join("\n");
ok("brand: EB Garamond is the face", /EB Garamond/.test(css) && /family=EB\+Garamond/.test(html));
ok("brand: no Cormorant Garamond (caithrin face)", !/Cormorant/i.test(css + html));
ok("brand: no caithrin palette", !/#(16120e|f4efe6|7d6448)\b/i.test(css + html));
ok("brand: no caithrin d20 mark", !/d20-(black|white|final|exact|tile)\.svg|dice-(bold|all)\.svg/.test(html + css + js));
/* Substack's button orange is allowed in exactly one place: the .nm-btn rule of the figure
   labelled "Example of the print link at the end of a Substack post", which depicts a
   Substack post. Anywhere else it reads as affiliation. */
const orangeOutsideMockup = (css + html + js).replace(/\.nm-btn\{[^}]*\}/g, "");
ok("brand: no Substack logo assets", !/substackcdn\.com|substack\.com\/img/i.test(html + css + js));
ok("brand: Substack orange only inside the labelled post mockup", !/#ff6719\b/i.test(orangeOutsideMockup)
  && /aria-label="Example of the print link at the end of a Substack post"/.test(html));

/* reachable-state checks against the live API (the audit's core objection) */
if (sourceOnly) { console.log(`HONESTY GATE (source only): ${n} checks passed`); process.exit(0); }
const acx = await (await fetch(base + "/api/preview?url=astralcodexten.com")).json();
if (acx.ok) {
  const rec = acx.recommended.cadence;
  ok("ACX recommendation is feasible or concierge",
    rec === "concierge" || (acx.divisions[rec] && acx.divisions[rec].feasible),
    "rec=" + rec);
} else console.log("SKIP ACX reachable-state (api: " + acx.error + ")");
const cai = await (await fetch(base + "/api/preview?url=caithrin.com")).json();
if (cai.ok) {
  ok("caithrin recommendation feasible", cai.divisions[cai.recommended.cadence].feasible);
  ok("capped flag is boolean", typeof cai.capped === "boolean");
  ok("caithrin is a full read (not capped)", cai.capped === false);
} else console.log("SKIP caithrin reachable-state");
const hcr = await (await fetch(base + "/api/preview?url=heathercoxrichardson.substack.com")).json();
if (hcr.ok) {
  /* since 2026-09-01 the relay reads HCR's whole window; the flag must still be true to the read */
  ok("HCR capped flag is boolean and matches the read", typeof hcr.capped === "boolean" && (hcr.capped || (hcr.editorial && hcr.editorial.totals.posts > 300)), "capped=" + hcr.capped + " posts=" + (hcr.editorial && hcr.editorial.totals.posts));
  const rec = hcr.divisions[hcr.recommended.cadence];
  ok("HCR recommended set size is not a measured shipping point", !prices.shipping_by_volumes[String(rec.volumes.length)], "n=" + rec.volumes.length);
} else console.log("SKIP HCR reachable-state");

/* ---------- the editorial plan (plan-end-to-end-v1): every gate host carries one that passes the checker ---------- */
const LABEL = /^(Q[1-4] \d{4}|H[12] \d{4}|[A-Z][a-z]{2} \d{4}|\d{4}(–\d{2})?|Q[1-4] \d{4} – Q[1-4] \d{4})( – [A-Z][a-z]{2} \d{4})?( · [IVX]+)?$/;
for (const [name, d] of [["caithrin", cai], ["HCR", hcr], ["ACX", acx]]) {
  if (!d.ok) continue;
  const ed = d.editorial;
  ok(name + ": editorial plan present", !!(ed && ed.plan && Array.isArray(ed.plan.routes)));
  if (!ed || !ed.plan) continue;
  ok(name + ": checker passed", Array.isArray(ed.errors) && ed.errors.length === 0, (ed.errors || []).slice(0, 2).join("; "));
  ok(name + ": window is four completed quarters", !!(ed.window && /^[A-Z][a-z]{2} \d{4} – [A-Z][a-z]{2} \d{4}$/.test(ed.window.span)), ed.window && ed.window.span);
  ok(name + ": the quarter in progress is stated", !!(ed.window && ed.window.in_progress && /^Q[1-4] \d{4}$/.test(ed.window.in_progress.label)));
  const rec = ed.plan.routes.filter(r => r.recommended);
  ok(name + ": exactly one golden route when any route binds", ed.plan.routes.length === 0 || rec.length === 1, "routes=" + ed.plan.routes.length);
  for (const r of ed.plan.routes) {
    ok(name + " " + r.cadence + ": every label in the vocabulary", r.volumes.every(v => LABEL.test(v.label)), r.volumes.map(v => v.label).filter(l => !LABEL.test(l)).join(", "));
    ok(name + " " + r.cadence + ": every volume 32 to 300 pages", r.volumes.every(v => v.est_pages >= 32 && v.est_pages <= 300), r.volumes.map(v => v.label + ":" + v.est_pages).join(" "));
    ok(name + " " + r.cadence + ": prices derived per volume", r.volumes.every(v => v.price && typeof v.price.bw === "number" && typeof v.price.color === "number"));
  }
  ok(name + ": planned by the editor or honestly by the calendar", ed.planned_by === "editor" || (ed.planned_by === "calendar" && typeof ed.reason === "string"));
}

console.log(`HONESTY GATE: ${n} checks passed`);
