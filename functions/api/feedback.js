// POST /api/feedback — one piece of visitor feedback into D1, so every remark from the beta is
// kept where we can read it. No cookies, no IP stored. Honeypot, size caps, a global rate cap.
export async function onRequest({ request, env }) {
  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405, { allow: "POST" });
  if (Number(request.headers.get("content-length") || 0) > 16_384) return json({ ok: false, error: "too large" }, 413);
  let body; try { body = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
  if (body.website) return json({ ok: true }); /* honeypot filled: pretend success, store nothing */
  const text = String(body.text || "").trim();
  if (text.length < 3) return json({ ok: false, error: "Say a little more; even one sentence helps." }, 400);
  if (text.length > 4000) return json({ ok: false, error: "That is longer than we can keep; 4,000 characters is the limit." }, 400);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "That email does not look right; leave it blank if you prefer." }, 400);
  const publication = String(body.publication || "").trim().slice(0, 200);
  const page = String(body.page || "").trim().slice(0, 200);
  const ua = String(request.headers.get("user-agent") || "").slice(0, 200);
  const recent = await env.DB.prepare("SELECT count(*) n FROM feedback WHERE created_at > datetime('now','-60 seconds')").first().catch(() => ({ n: 0 }));
  if ((recent?.n || 0) >= 30) return json({ ok: false, error: "busy" }, 429);
  try {
    await env.DB.prepare("INSERT INTO feedback (text, email, publication, page, ua) VALUES (?, ?, ?, ?, ?)").bind(text, email || null, publication || null, page || null, ua || null).run();
  } catch (e) { return json({ ok: false, error: "Could not save that just now. Write to caithrin@caithrin.com and it reaches the same place." }, 500); }
  return json({ ok: true });
}
function json(obj, status = 200, extra = {}) { return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...extra } }); }
