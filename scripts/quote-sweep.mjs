// Sweep Lulu print costs across page counts for the packages Inksheaf offers,
// fit the linear base+per-page curve Lulu uses, and write the measured
// coefficients the site quotes from. Rerun to refresh: node scripts/quote-sweep.mjs
// Requires: source ~/.secrets/lulu
import { makeClient } from "./lulu-client.mjs";
import { readFile, writeFile } from "fs/promises";

const PODS = {
  bw:    "0600X0900.BW.STD.PB.060UW444.MXX",   // 6x9 B&W, 60# uncoated
  color: "0600X0900.FC.STD.PB.060UW444.MXX",   // 6x9 standard colour, same paper
};
const PAGES = [60, 120, 180, 240, 300, 360, 420, 480, 540, 600];

const c = makeClient({ production: true });
const addr = JSON.parse(await readFile(process.env.HOME + "/.secrets/inksheaf-ref-address.json", "utf8"));

const out = { measured: new Date().toISOString().slice(0, 10), currency: "USD",
  shipping_mail: null, note: "print cost per copy, quantity 1; fit is least-squares linear", pods: {} };

for (const [key, pod] of Object.entries(PODS)) {
  const points = [];
  for (const pages of PAGES) {
    const q = await c.costQuote(pages, addr, { pod });
    const li = q.line_item_costs[0];
    const print = Number(li.cost_excl_discounts ?? li.total_cost_excl_discounts);
    if (!Number.isFinite(print)) throw new Error(`bad quote ${key} ${pages}pp`);
    points.push([pages, print]);
    out.shipping_mail ??= Number(q.shipping_cost.total_cost_excl_tax);
    console.log(key, pages + "pp", "$" + print);
  }
  const n = points.length;
  const sx = points.reduce((s, [x]) => s + x, 0), sy = points.reduce((s, [, y]) => s + y, 0);
  const sxx = points.reduce((s, [x]) => s + x * x, 0), sxy = points.reduce((s, [x, y]) => s + x * y, 0);
  const per_page = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const base = (sy - per_page * sx) / n;
  const worst = Math.max(...points.map(([x, y]) => Math.abs(base + per_page * x - y)));
  out.pods[key] = { pod_package_id: pod, base: +base.toFixed(4), per_page: +per_page.toFixed(5),
    max_fit_error: +worst.toFixed(3), points };
  console.log(key, "fit: base $" + base.toFixed(2), "+ $" + per_page.toFixed(4) + "/page, max err $" + worst.toFixed(2));
}
// Set shipping is measured at 1, 2, 4 and 8 volumes; the page prints these four exactly and
// says "about" for any other count. Raw quotes go to the vault evidence folder with a date.
out.shipping_by_volumes = {};
const raw = { measured: out.measured, shipping_option: "MAIL", destination: addr.state_code + ", " + addr.country_code, quotes: {} };
for (const n of [1, 2, 4, 8]) {
  const items = Array.from({ length: n }, () => ({ page_count: 200, pod_package_id: PODS.bw, quantity: 1 }));
  const q = await c.api("/print-job-cost-calculations/", { line_items: items, shipping_address: addr, shipping_option: "MAIL" });
  out.shipping_by_volumes[n] = Number(q.shipping_cost.total_cost_excl_tax);
  raw.quotes[n] = { shipping_cost: q.shipping_cost, total_cost_excl_tax: q.total_cost_excl_tax, total_cost_incl_tax: q.total_cost_incl_tax };
  console.log("shipping x" + n, out.shipping_by_volumes[n]);
}
await writeFile("functions/lib/print-prices.json", JSON.stringify(out, null, 1));
console.log("wrote functions/lib/print-prices.json");
const EVIDENCE = process.env.INKSHEAF_EVIDENCE_DIR ||
  process.env.HOME + "/Library/Mobile Documents/com~apple~CloudDocs/Caithrin/05-Projects/Substack Magazine/evidence";
const evPath = EVIDENCE + "/lulu-shipping-" + out.measured + ".json";
await writeFile(evPath, JSON.stringify(raw, null, 1));
console.log("wrote", evPath);
