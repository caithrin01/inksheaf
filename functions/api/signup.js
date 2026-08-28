// POST /api/signup — store one beta signup in D1. No cookies, no IP stored.
const FIELDS = ["publication_url","name","role","email","archive_type","frequency",
  "posts_per_year","cadence_pref","us_subscribers","expected_orders",
  "founding_count","price_range","interview_ok","concern"];

export async function onRequest({ request, env }) {
  if (request.method !== "POST")
    return new Response(JSON.stringify({ ok:false, error:"method not allowed" }),
      { status: 405, headers: { "content-type":"application/json", "allow":"POST" } });

  if (Number(request.headers.get("content-length") || 0) > 16_384) return bad("request too large", 413);
  const recent = await env.DB.prepare(
    "SELECT count(*) n FROM signups WHERE created_at > datetime('now','-60 seconds')"
  ).first().catch(() => ({ n: 0 }));
  if ((recent?.n || 0) >= 30) return bad("busy", 429);

  let body;
  try { body = await request.json(); } catch { return bad("invalid json"); }
  if (body.website) return ok(); // honeypot filled: pretend success, store nothing

  const rawUrl = String(body.publication_url || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  if (rawUrl.length > 300) return bad("url too long");
  if (email.length > 200) return bad("email too long");
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return bad("bad url"); }
  if (!/^https?:$/.test(parsed.protocol)) return bad("bad url scheme");
  parsed.hash = ""; parsed.search = "";
  const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  const url = parsed.origin.toLowerCase() + path;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("bad email");

  const clean = {};
  for (const k of FIELDS) clean[k] = body[k] == null ? null : String(body[k]).slice(0, 300);
  clean.publication_url = url;
  clean.email = email;
  clean.posts_per_year = Number.parseInt(clean.posts_per_year, 10) || null;

  // Exact resubmission of the same publication by the same email: acknowledge, store once.
  const dupe = await env.DB.prepare(
    "SELECT id FROM signups WHERE email = ? AND publication_url = ? LIMIT 1"
  ).bind(email, url).first();
  if (dupe) return ok();

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
const bad = (m, status = 400) => new Response(JSON.stringify({ ok: false, error: m }),
  { status, headers: { "content-type": "application/json" } });
