#!/usr/bin/env node
// Read-only-by-default probe of the website GraphQL API at api.lulu.com/graphql/ using the Print
// API client-credentials token (realm glasstree). Prints status only, never the token, spends
// nothing. With --create-own it creates ONE draft project under the service identity, reads it,
// and ALWAYS deletes it (try/finally), to learn whether the service token can own projects.
// Usage: source ~/.secrets/lulu && node scripts/lulu-gql-probe.mjs [--create-own]
const BASE = "https://api.lulu.com";
const KEY = process.env.LULU_CLIENT_KEY, SECRET = process.env.LULU_CLIENT_SECRET;
if (!KEY || !SECRET) { console.error("creds not set (source ~/.secrets/lulu)"); process.exit(2); }
const CREATE = process.argv.includes("--create-own");

const r = await fetch(`${BASE}/auth/realms/glasstree/protocol/openid-connect/token`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "client_credentials", client_id: KEY, client_secret: SECRET }) });
const d = await r.json();
if (!d.access_token) { console.log("AUTH FAILED", r.status, d.error_description || d.error); process.exit(0); }
const claims = JSON.parse(Buffer.from(d.access_token.split(".")[1], "base64").toString());
console.log("token: aud", JSON.stringify(claims.aud), "clientId", claims.clientId || claims.azp);

async function gql(query, variables = {}) {
  const g = await fetch(`${BASE}/graphql/`, { method: "POST", headers: { authorization: `Bearer ${d.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
  return { status: g.status, json: await g.json() };
}
const codes = j => (j.errors || []).map(e => e.extensions?.code || e.message).join(",");

// can the service identity see its own project space? (read-only; empty list is meaningful)
const list = await gql("query{ projects(first:3){ totalCount edges{ node{ id projectTitle status } } } }");
console.log("projects(own):", list.status, list.json.errors ? "err="+codes(list.json) : "OK "+JSON.stringify(list.json.data).slice(0,200));
const alt = await gql("query{ projectList{ __typename } }");
console.log("projectList shape:", alt.status, alt.json.errors ? "err="+codes(alt.json) : "OK "+JSON.stringify(alt.json.data).slice(0,120));

// shape-probe (read-only): what fields does projectList expose, and does the service account hold any projects?
for (const sel of ["results{ id projectTitle status } pageCount totalCount", "results{ id projectTitle } pageCount", "results{ id }"]) {
  const p = await gql(`query{ projectList{ ${sel} } }`);
  console.log("projectList{", sel.split("{")[0].trim(), "} ->", p.status, p.json.errors ? "err="+codes(p.json) : "OK "+JSON.stringify(p.json.data).slice(0,300));
  if (!p.json.errors) break;
}

if (!CREATE) process.exit(0);
let id = null;
try {
  const c = await gql("mutation($t:ProductTypeEnum!){ createProject(projectType:$t){ id availableOperations luluBookstoreSellIntention } }", { t: "PRINTED_BOOK" });
  console.log("createProject:", c.status, c.json.errors ? "err="+codes(c.json) : "OK");
  id = c.json.data?.createProject?.id;
  if (id) {
    console.log("  created id", id, "ops", JSON.stringify(c.json.data.createProject.availableOperations)?.slice(0,140));
    const rd = await gql("query($id:ID!){ project(id:$id){ id projectTitle status } }", { id });
    console.log("read own project:", rd.status, rd.json.errors ? "err="+codes(rd.json) : "OK "+JSON.stringify(rd.json.data));
  }
} finally {
  if (id) { const del = await gql("mutation($id:ID!){ deleteProject(projectId:$id){ id } }", { id }); console.log("deleteProject cleanup:", del.status, del.json.errors ? "err="+codes(del.json) : "OK"); }
}
