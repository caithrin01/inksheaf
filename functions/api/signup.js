// POST /api/signup — store one beta signup in D1 and start the press. No cookies, no IP stored.
import { validDesign } from "../lib/book-design.js";
import { startPrivatePdf, editionLink, reservePdfCapacity } from '../lib/private-pdf.js';
import { parseHost, readLimitedText } from './preview.js';
import { ipKey } from '../lib/quota.js';
import { funnelHost, funnelSession, recordFunnel, scheduleFunnelAlert } from "../lib/funnel.js";
const FIELDS = ["publication_url","name","role","email","archive_type","frequency",
  "posts_per_year","cadence_pref","us_subscribers","expected_orders",
  "founding_count","price_range","interview_ok","concern","plan_json"];

export async function onRequest({ request, env, waitUntil }) {
  if (request.method !== "POST")
    return new Response(JSON.stringify({ ok:false, error:"method not allowed" }),
      { status: 405, headers: { "content-type":"application/json", "allow":"POST" } });

  if (Number(request.headers.get("content-length") || 0) > 32_768) return bad("request too large", 413);
  const recent = await env.DB.prepare(
    "SELECT count(*) n FROM signups WHERE created_at > datetime('now','-60 seconds')"
  ).first().catch(() => ({ n: 0 }));
  if ((recent?.n || 0) >= 30) return bad("busy", 429);

  let body;
  try { body = JSON.parse(await readLimitedText(request, 32_768)); } catch { return bad("invalid json"); }
  if (body.website) return ok(); // honeypot filled: pretend success, store nothing

  const rawUrl = String(body.publication_url || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const reservationKey = body.reservation_key == null ? null : String(body.reservation_key);
  if (reservationKey !== null && !/^[0-9a-f-]{36}$/.test(reservationKey)) return bad("invalid reservation key");
  if (rawUrl.length > 300) return bad("url too long");
  if (email.length > 200) return bad("email too long");
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return bad("bad url"); }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.port || !parseHost(rawUrl)) return bad("bad url scheme");
  parsed.hash = ""; parsed.search = "";
  const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  const url = parsed.origin.toLowerCase() + path;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("bad email");

  const clean = {};
  for (const k of FIELDS) clean[k] = body[k] == null ? null : String(body[k]).slice(0, 300);
  /* plan_json is a JSON document, not a form field; it gets its own cap */
  clean.plan_json = body.plan_json == null ? null : String(body.plan_json).slice(0, 24000);
  if (clean.plan_json) {
    let selection;
    try { selection = JSON.parse(clean.plan_json); } catch { return bad("invalid edition plan"); }
    if (selection?.design && !validDesign(selection.design)) return bad("unsupported cover design");
  }
  clean.publication_url = url;
  clean.email = email;
  clean.posts_per_year = Number.parseInt(clean.posts_per_year, 10) || null;
  const requestHash = reservationKey ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([url, email, clean.plan_json || null]))))].map(n => n.toString(16).padStart(2, "0")).join("") : null;

  // Retrying an intent resumes it; a deliberate new edition gets a new key. Older
  // clients retain their existing reservation rather than changing its saved plan.
  const dupe = reservationKey
    ? await env.DB.prepare("SELECT * FROM signups WHERE reservation_key = ?").bind(reservationKey).first()
    : await env.DB.prepare("SELECT * FROM signups WHERE email = ? AND publication_url = ? ORDER BY id DESC LIMIT 1").bind(email, url).first();
  const resume = async row => {
    if (row.email !== email || row.publication_url !== url || (reservationKey && row.reservation_payload_hash !== requestHash))
      return bad("reservation details changed; start a new request", 409);
    if (/\+journeytest@caithrin\.com$/i.test(email)) return reply({ ok: true, id: row.id, press: "test" });
    const state = await startPrivatePdf(env, row);
    // A legacy email + URL match is not a secret. Only the originating request key
    // can recover its private workspace; old email links keep their own scopes.
    return reply({ ok: true, id: row.id, existing: true, ...state,
      workspace_url: reservationKey ? await editionLink(env, row.id) : null });
  };
  if (dupe) return resume(dupe);

  if (!/\+journeytest@caithrin\.com$/i.test(email)) {
    try { if (!await reservePdfCapacity(env, { host: parsed.hostname, ip: await ipKey(request) })) return bad('The press is full for now. Your choices are still here; please try again later.', 429); }
    catch { return bad('The press is temporarily unavailable. Your choices are still here.', 503); }
  }
  const inserted = await env.DB.prepare(
    `INSERT INTO signups (publication_url,name,role,email,archive_type,frequency,
       posts_per_year,cadence_pref,us_subscribers,expected_orders,founding_count,
       price_range,interview_ok,concern,plan_json,raw_json,reservation_key,reservation_payload_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(reservation_key) DO NOTHING`
  ).bind(
    clean.publication_url, clean.name, clean.role, clean.email, clean.archive_type,
    clean.frequency, clean.posts_per_year, clean.cadence_pref, clean.us_subscribers,
    clean.expected_orders, clean.founding_count, clean.price_range, clean.interview_ok,
    clean.concern, String(clean.plan_json || "").slice(0, 24000) || null, JSON.stringify(clean), reservationKey, requestHash
  ).run();
  const row = reservationKey
    ? await env.DB.prepare("SELECT * FROM signups WHERE reservation_key = ?").bind(reservationKey).first()
    : await env.DB.prepare("SELECT * FROM signups WHERE email = ? AND publication_url = ? ORDER BY id DESC LIMIT 1").bind(email, url).first();
  if (!row?.id) return bad("We could not confirm the saved reservation. Please retry.", 503);
  if (inserted?.meta?.changes === 0) return resume(row);
  const session = funnelSession(body.session) || funnelSession(`signup${row.id}`);
  const host = funnelHost(url);
  const tracked = await recordFunnel(env, { session, host, event: "signup", signup_id: row.id });
  if (tracked.alert && !/\+journeytest@caithrin\.com$/i.test(email))
    scheduleFunnelAlert(waitUntil, env, { ...tracked, stage: "signup", email });
  if (/\+journeytest@caithrin\.com$/i.test(email)) { await env.DB.prepare("UPDATE signups SET dispatch_status = 'test' WHERE id = ?").bind(row.id).run().catch(() => {}); return new Response(JSON.stringify({ ok: true, id: row.id, press: "test" }), { headers: { "content-type": "application/json" } }); }
  const state = await startPrivatePdf(env, row);
  return reply({ ok: true, id: row.id, ...state, workspace_url: await editionLink(env, row.id) });
}
const reply = body => new Response(JSON.stringify(body), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
const ok  = () => new Response(JSON.stringify({ ok: true }),
  { headers: { "content-type": "application/json" } });
const bad = (m, status = 400) => new Response(JSON.stringify({ ok: false, error: m }),
  { status, headers: { "content-type": "application/json" } });
