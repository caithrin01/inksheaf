#!/usr/bin/env node
// Human-gate journey battery (beta-launch-readiness Track A/B core).
// Runs real browser journeys with a pageerror listener on every page; a silent console
// exception fails the row even when the screen looks right.
// Usage: NODE_PATH=<playwright dir> node scripts/test-journeys.mjs [chromium|webkit] [base]
import { strict as assert } from "node:assert";

const engineName = process.argv[2] || "chromium";
const base = (process.argv[3] || "https://inksheaf.com").replace(/\/$/, "");
const pw = await import("playwright");
const engine = pw[engineName];
const browser = await engine.launch();
let failures = 0;

async function journey(name, opts, fn) {
  const ctx = await browser.newContext({
    viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1440, height: 950 },
    colorScheme: opts.dark ? "dark" : "light",
    hasTouch: !!opts.mobile,
    javaScriptEnabled: !opts.noJs,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 140)));
  try {
    await fn(page);
    assert.equal(errors.length, 0, "pageerrors: " + errors.join(" | "));
    console.log(`PASS ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name} :: ${String(e.message).slice(0, 160)}`);
  } finally { await ctx.close(); }
}

const preview = async (page, url) => {
  await page.goto(base + "/");
  await page.fill("#tryurl", url);
  await page.click("#trybtn");
  await page.waitForFunction(() =>
    document.getElementById("preview").classList.contains("personalized") ||
    document.getElementById("tryerr").textContent.length > 3, null, { timeout: 150000 });
  await page.waitForTimeout(900);
};

await journey("A1 caithrin reveal lands with desk pre-set", {}, async page => {
  await preview(page, "caithrin.com");
  assert.ok(await page.evaluate(() => document.getElementById("preview").classList.contains("personalized")));
  const tabs = await page.evaluate(() => [...document.querySelectorAll(".desk-tab")].map(b => b.getAttribute("aria-selected")));
  assert.ok(tabs.includes("true"), "a cadence is pre-selected");
  const pressed = await page.evaluate(() => [...document.querySelectorAll(".int-opt")].map(b => [b.textContent, b.getAttribute("aria-pressed")]));
  assert.ok(pressed.find(([t, p]) => /Black/.test(t) && p === "true"), "bw is the default interior: " + JSON.stringify(pressed));
});

await journey("A2 book opens by hover, keyboard, and tap", {}, async page => {
  await preview(page, "caithrin.com");
  await page.waitForTimeout(1200); /* reveal animations and font swaps shift layout */
  await page.evaluate(() => document.getElementById("bookwrap").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  const box = await page.locator("#bookwrap").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1000);
  const hoverDeg = await page.evaluate(() => getComputedStyle(document.querySelector(".cover")).transform);
  assert.ok(hoverDeg && hoverDeg !== "none", "cover transforms on hover");
  await page.mouse.move(5, 5); await page.waitForTimeout(950);
  await page.evaluate(() => document.getElementById("bookwrap").focus());
  await page.keyboard.press("Enter"); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.getElementById("bookwrap").getAttribute("aria-pressed")), "true", "keyboard opens");
  await page.keyboard.press(" "); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.getElementById("bookwrap").getAttribute("aria-pressed")), "false", "keyboard closes");
});

await journey("A3 cadence and interior switching stays truthful", {}, async page => {
  await preview(page, "heathercoxrichardson.substack.com");
  const enabled = await page.evaluate(() => [...document.querySelectorAll(".desk-tab:not(:disabled)")].map(b => b.textContent.trim()));
  for (const label of enabled) {
    await page.getByRole("tab", { name: label }).click();
    await page.waitForTimeout(650);
    const segs = await page.evaluate(() => [...document.querySelectorAll(".folio-seg")].length);
    const verdict = await page.evaluate(() => document.getElementById("desk-verdict").textContent);
    assert.ok(segs >= 1, label + ": segments render");
    assert.ok(/\d+ (pages|issues|volumes)|one (issue|volume)/.test(verdict), label + ": verdict has numbers: " + verdict.slice(0, 60));
  }
  const before = await page.evaluate(() => document.getElementById("pv-price").textContent);
  await page.evaluate(() => [...document.querySelectorAll(".int-opt")].find(b => /Colour/.test(b.textContent)).click());
  await page.waitForTimeout(500);
  const priceTexts = await page.evaluate(() => [...document.querySelectorAll(".folio-seg .fs-price")].map(x => x.textContent));
  assert.ok(priceTexts.length >= 1, "per-volume prices shown");
});

await journey("A4+A5 handoff carries the plan; dedupe holds", {}, async page => {
  await preview(page, "caithrin.com");
  const q = await page.getByRole("tab", { name: "Quarterly" });
  if (await q.isEnabled()) { await q.click(); await page.waitForTimeout(400); }
  await page.click("#pv-cta"); await page.waitForTimeout(500);
  const carried = await page.evaluate(() => document.getElementById("carried").textContent);
  assert.ok(/Caithrin/i.test(carried), "carried names the publication");
  const plan = JSON.parse(await page.evaluate(() => document.getElementById("plan_json").value));
  assert.ok(plan.cadence && Array.isArray(plan.volumes), "plan parses");
  await page.fill("#email", "caithrin+journeytest@caithrin.com");
  await page.getByRole("button", { name: "Request a spot" }).click();
  await page.waitForFunction(() => document.getElementById("done").style.display === "block", null, { timeout: 20000 });
});

await journey("A6 second publication fully replaces the first", {}, async page => {
  await preview(page, "caithrin.com");
  await preview(page, "heathercoxrichardson.substack.com");
  const mast = await page.evaluate(() => document.getElementById("pv-mast").textContent);
  const sub = await page.evaluate(() => document.getElementById("pv-sub").textContent);
  assert.ok(/Letters from an American/i.test(mast), "cover is HCR: " + mast);
  assert.ok(!/caithrin/i.test(sub), "no stale caithrin in payoff");
  /* HCR is a capped read (audit gate 3): nothing on the desk may read as final */
  assert.ok(/estimates until we read the rest/.test(sub), "capped sentence present: " + sub.slice(-120));
  assert.ok(!/covers the full year/.test(sub), "old full-year claim gone");
  const big = await page.evaluate(() => document.getElementById("pv-big").textContent);
  assert.ok(/so far|at least|about/.test(big), "headline hedged when capped: " + big);
  const verdict = await page.evaluate(() => document.getElementById("desk-verdict").textContent);
  assert.ok(/about \d+ (volumes|issues)|of about \d+ pages/.test(verdict), "verdict hedged when capped: " + verdict.slice(0, 80));
  const price = await page.evaluate(() => document.getElementById("pv-price").textContent);
  assert.ok(/plus about \$\d+ shipping/.test(price), "shipping is 'about' when capped or unmeasured: " + price.slice(0, 80));
});

await journey("A6b uncapped single volume quotes measured shipping exactly", {}, async page => {
  await preview(page, "caithrin.com");
  const sub = await page.evaluate(() => document.getElementById("pv-sub").textContent);
  assert.ok(!/estimates until we read the rest/.test(sub), "no capped sentence on a full read");
  const price = await page.evaluate(() => document.getElementById("pv-price").textContent);
  assert.ok(/plus \$5\.69 shipping, mainland US/.test(price), "measured 1-volume shipping exact: " + price.slice(0, 80));
});

await journey("A7 failure after success clears the desk, keeps the book", {}, async page => {
  await preview(page, "caithrin.com");
  await preview(page, "nytimes.com");
  assert.ok(!(await page.evaluate(() => document.getElementById("preview").classList.contains("personalized"))), "personalized cleared");
  const bookVisible = await page.evaluate(() => document.getElementById("bookwrap").offsetHeight > 0);
  assert.ok(bookVisible, "specimen book still visible");
  const err = await page.evaluate(() => document.getElementById("tryerr").textContent);
  assert.ok(/Substack/i.test(err), "honest message: " + err.slice(0, 60));
});

await journey("A8 concierge state handoff (ACX)", {}, async page => {
  await preview(page, "astralcodexten.com");
  const verdict = await page.evaluate(() => document.getElementById("desk-verdict").textContent);
  assert.ok(/by hand/.test(verdict), "concierge verdict: " + verdict.slice(0, 60));
  await page.click("#pv-cta"); await page.waitForTimeout(500);
  const plan = JSON.parse(await page.evaluate(() => document.getElementById("plan_json").value));
  assert.equal(plan.cadence, "concierge");
  assert.equal(plan.needs_hand_plan, true);
});

await journey("A9 deep link reproduces a preview", {}, async page => {
  await page.goto(base + "/?pub=caithrin.com");
  await page.waitForFunction(() => document.getElementById("preview").classList.contains("personalized"), null, { timeout: 150000 });
});

await journey("A10 double-clicks and refresh mid-flight", {}, async page => {
  await page.goto(base + "/");
  await page.fill("#tryurl", "caithrin.com");
  await page.click("#trybtn"); await page.click("#trybtn").catch(() => {});
  await page.waitForTimeout(600);
  await page.reload();
  await preview(page, "caithrin.com");
  await page.click("#pv-cta"); await page.waitForTimeout(400);
  await page.fill("#email", "caithrin+journeytest@caithrin.com");
  const btn = page.getByRole("button", { name: "Request a spot" });
  await btn.click(); await btn.click().catch(() => {});
  await page.waitForFunction(() => document.getElementById("done").style.display === "block", null, { timeout: 20000 });
});

/* the reveal lands on the book (audit gate 6): focus moves to it, the status line announces
   the result, and the book sits at the top of the viewport on both desktop and mobile */
const assertLanding = async (page, viewportH) => {
  await page.waitForTimeout(1500); /* smooth scroll and the 0.7s rise both settle */
  const r = await page.evaluate(() => {
    const b = document.getElementById("bookwrap").getBoundingClientRect();
    const big = document.getElementById("pv-big").getBoundingClientRect();
    return { active: document.activeElement && document.activeElement.id, status: document.getElementById("pv-status").textContent,
      bookTop: Math.round(b.top), bookBottom: Math.round(b.bottom), bigTop: Math.round(big.top) };
  });
  assert.equal(r.active, "bookwrap", "focus moved to the book");
  assert.match(r.status, /^Your book is ready: (about )?\d+ (pages|volumes|issues)\.$/, "status announced: " + r.status);
  assert.ok(r.bookTop >= 0 && r.bookTop <= 120, "book top near the top of the viewport: " + r.bookTop);
  assert.ok(r.bookBottom <= viewportH, "whole book inside the viewport: bottom " + r.bookBottom);
  assert.ok(r.bigTop < viewportH, "the one-line fact is inside the first viewport: " + r.bigTop);
};

await journey("A11 reveal lands on the book (desktop)", {}, async page => {
  await preview(page, "caithrin.com");
  await assertLanding(page, 950);
});

await journey("A1m mobile dark: reveal + desk in first viewports", { mobile: true, dark: true }, async page => {
  await preview(page, "caithrin.com");
  assert.ok(await page.evaluate(() => document.getElementById("preview").classList.contains("personalized")));
  await assertLanding(page, 844);
  const tap = await page.evaluate(() => document.querySelector(".bookhint .tap") && getComputedStyle(document.querySelector(".bookhint .tap")).display !== "none");
  await page.tap("#bookwrap"); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.getElementById("bookwrap").getAttribute("aria-pressed")), "true", "tap opens on touch");
});

/* A13: with scripts off the page still reads and the form's noscript fallback offers a
   working mailto; the specimen book is server-rendered so it is present too */
await journey("A13 no-JS fallback with a working mailto", { noJs: true }, async page => {
  await page.goto(base + "/");
  const r = await page.evaluate(() => {
    const ns = document.querySelector("noscript");
    const mail = !!document.querySelector('noscript a[href="mailto:caithrin@caithrin.com"]');
    const spaced = /write to caithrin@caithrin\.com and we will/.test(ns ? ns.textContent : "");
    const book = document.getElementById("bookwrap");
    const visible = el => !!el && el.getBoundingClientRect().height > 0;
    const title = document.querySelector("h1");
    return { mail, spaced, book: visible(book), title: visible(title), noscriptShown: visible(ns) };
  });
  assert.ok(r.spaced, "fallback sentence keeps its spaces (Astro's compressor once ate the one before the address)");
  assert.ok(r.title, "headline renders without scripts");
  assert.ok(r.book, "specimen book renders without scripts");
  assert.ok(r.mail, "noscript fallback carries the mailto");
  assert.ok(r.noscriptShown, "noscript fallback is displayed");
});

await browser.close();
console.log(failures ? `JOURNEY GATE FAILED: ${failures} rows` : "JOURNEY GATE: all rows passed");
process.exit(failures ? 1 : 0);
