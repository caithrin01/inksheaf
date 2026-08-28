#!/usr/bin/env node
// Lulu sandbox client. Credentials come ONLY from environment variables:
//   LULU_CLIENT_KEY, LULU_CLIENT_SECRET   (sandbox keys from developers.sandbox.lulu.com)
// Nothing here prints, logs, or stores the secret or any token.
//
// Commands:
//   node scripts/lulu.mjs auth            — prove the credential works (prints only token type + expiry)
//   node scripts/lulu.mjs costs           — run the plan's US measurement matrix (task 10) and
//                                           write vault evidence lulu-costs.json (schema per validator.md)
//   node scripts/lulu.mjs cover <pages>   — cover dimensions for the 6x9 package at <pages>
//   node scripts/lulu.mjs shipping        — shipping options for a 132pp single copy to the matrix cities
// Add --production to target api.lulu.com (default is the sandbox; production never silent).

import { writeFileSync } from "node:fs";

const KEY = process.env.LULU_CLIENT_KEY, SECRET = process.env.LULU_CLIENT_SECRET;
if (!KEY || !SECRET) {
  console.error("LULU_CLIENT_KEY / LULU_CLIENT_SECRET not set. Create sandbox keys at");
  console.error("https://developers.sandbox.lulu.com/user-profile/api-keys and export both in your shell profile.");
  process.exit(2);
}
const PROD = process.argv.includes("--production");
const BASE = PROD ? "https://api.lulu.com" : "https://api.sandbox.lulu.com";
const POD = "0600X0900.BW.STD.PB.060UW444.MXX"; // 6x9, BW, standard, perfect bound, 60# white, matte

const DESTINATIONS = [
  { label: "west",    city: "Seattle",    state_code: "WA", postcode: "98101", street1: "400 Broad St" },
  { label: "central", city: "Austin",     state_code: "TX", postcode: "78701", street1: "100 Congress Ave" },
  { label: "east",    city: "Washington", state_code: "DC", postcode: "20540", street1: "101 Independence Ave SE" },
  { label: "alaska",  city: "Anchorage",  state_code: "AK", postcode: "99501", street1: "632 W 6th Ave" },
  { label: "hawaii",  city: "Honolulu",   state_code: "HI", postcode: "96813", street1: "530 S King St" },
];
const PAGES = [60, 132, 220, 300];

async function token() {
  const r = await fetch(`${BASE}/auth/realms/glasstree/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: KEY, client_secret: SECRET }),
  });
  if (!r.ok) throw new Error(`auth ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function api(path, body, tok, method = body ? "POST" : "GET") {
  const r = await fetch(`${BASE}${path}`, {
    method, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const cmd = process.argv[2] || "auth";
const t = await token();
if (cmd === "auth") {
  console.log(JSON.stringify({ ok: true, base: BASE, token_type: t.token_type, expires_in: t.expires_in }));
  process.exit(0);
}
const tok = t.access_token;

if (cmd === "cover") {
  const pages = +process.argv[3] || 132;
  const d = await api("/cover-dimensions/", { pod_package_id: POD, interior_page_count: pages, unit: "pt" }, tok);
  console.log(JSON.stringify({ pages, ...d }));
} else if (cmd === "shipping") {
  // price ladder: cost-calculations per level; transit times from the carrier catalog
  const q = new URLSearchParams({ iso_country_code: "US", state_code: "WA", quantity: "1",
    pod_package_id: POD, page_count: "132", currency: "USD" });
  const cat = await api(`/shipping-options/?${q}`, null, tok);
  const transit = {};
  for (const o of (cat.results || cat)) {
    const t = transit[o.level] || [Infinity, -Infinity];
    transit[o.level] = [Math.min(t[0], o.transit_time), Math.max(t[1], o.transit_time)];
  }
  for (const dst of [DESTINATIONS[0], DESTINATIONS[3]]) {
    for (const level of ["MAIL", "GROUND", "PRIORITY_MAIL", "EXPEDITED", "EXPRESS"]) {
      try {
        const d = await api("/print-job-cost-calculations/", {
          line_items: [{ page_count: 132, pod_package_id: POD, quantity: 1 }],
          shipping_address: { city: dst.city, country_code: "US", postcode: dst.postcode,
            state_code: dst.state_code, street1: dst.street1, phone_number: "+1 206 555 0100" },
          shipping_option: level }, tok);
        const tt = transit[level] ? `${transit[level][0]}-${transit[level][1]}d` : "?";
        console.log(`${dst.label} ${level}: ship $${d.shipping_cost?.total_cost_excl_tax} total $${d.total_cost_excl_tax} transit ${tt}`);
      } catch (e) { console.log(`${dst.label} ${level}: unavailable`); }
      await new Promise(r => setTimeout(r, 350));
    }
  }
} else if (cmd === "costs") {
  const rows = [];
  for (const pages of PAGES) for (const dst of DESTINATIONS) {
    try {
      const d = await api("/print-job-cost-calculations/", {
        line_items: [{ page_count: pages, pod_package_id: POD, quantity: 1 }],
        shipping_address: { city: dst.city, country_code: "US", postcode: dst.postcode,
          state_code: dst.state_code, street1: dst.street1, phone_number: "+1 206 555 0100" },
        shipping_option: "MAIL",
      }, tok);
      const li = d.line_item_costs?.[0] || {};
      rows.push({ pages, destination: dst.label, state: dst.state_code, service: "MAIL",
        print_cost: +(li.cost_excl_discounts ?? li.total_cost_excl_discounts ?? 0),
        fulfillment: +(d.fulfillment_cost?.total_cost_excl_tax ?? 0),
        shipping: +(d.shipping_cost?.total_cost_excl_tax ?? 0),
        total: +(d.total_cost_excl_tax ?? 0),
        currency: d.currency });
      console.error(`ok ${pages}pp -> ${dst.label}: total ${d.total_cost_excl_tax} ${d.currency}`);
    } catch (e) { console.error(`ERR ${pages}pp -> ${dst.label}:`, String(e.message).slice(0, 160)); }
    await new Promise(r => setTimeout(r, 400));
  }
  const out = { source: PROD ? "lulu-production-api" : "lulu-sandbox-api",
    measured_at: new Date().toISOString().slice(0, 10), package_id: POD, rows };
  const dest = "/Users/caithrinrintoul/Library/Mobile Documents/com~apple~CloudDocs/Caithrin/05-Projects/Substack Magazine/evidence/lulu-costs.json";
  writeFileSync(dest, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ rows: rows.length, evidence: "evidence/lulu-costs.json" }));
} else {
  console.error("unknown command:", cmd); process.exit(2);
}
