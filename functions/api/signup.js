// POST /api/signup — store one beta signup in D1. No cookies, no IP stored.
const FIELDS = ["publication_url","name","role","email","archive_type","frequency",
  "posts_per_year","cadence_pref","us_subscribers","expected_orders",
  "founding_count","price_range","interview_ok","concern"];

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return bad("invalid json"); }
  if (body.website) return ok(); // honeypot filled: pretend success, store nothing
  const url = String(body.publication_url || "").trim().slice(0, 300);
  const email = String(body.email || "").trim().slice(0, 200);
  try { new URL(url); } catch { return bad("bad url"); }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("bad email");

  const clean = {};
  for (const k of FIELDS) clean[k] = body[k] == null ? null : String(body[k]).slice(0, 300);
  clean.posts_per_year = Number.parseInt(clean.posts_per_year, 10) || null;

  await env.DB.prepare(
    `INSERT INTO signups (publication_url,name,role,email,archive_type,frequency,
       posts_per_year,cadence_pref,us_subscribers,expected_orders,founding_count,
       price_range,interview_ok,concern,raw_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    clean.publication_url, clean.name, clean.role, clean.email, clean.archive_type,
    clean.frequency, clean.posts_per_year, clean.cadence_pref, clean.us_subscribers,
    clean.expected_orders, clean.founding_count, clean.price_range, clean.interview_ok,
    clean.concern, JSON.stringify(clean)
  ).run();
  return ok();
}
const ok  = () => new Response(JSON.stringify({ ok: true }),
  { headers: { "content-type": "application/json" } });
const bad = (m) => new Response(JSON.stringify({ ok: false, error: m }),
  { status: 400, headers: { "content-type": "application/json" } });
