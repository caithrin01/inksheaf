// Per-hour quotas on expensive work (Codex audit P0-8): a key (an IP, a host, an email) may spend
// at most `limit` units in the current hour bucket. Counted in D1 (quota_hits); a missing table or
// a database error never blocks the site, it only logs.
export async function spend(env, key, limit, units = 1) {
  const bucket = new Date().toISOString().slice(0, 13);
  try {
    await env.DB.prepare("INSERT INTO quota_hits (key, bucket, n) VALUES (?, ?, ?) ON CONFLICT(key, bucket) DO UPDATE SET n = n + excluded.n").bind(key, bucket, units).run();
    const row = await env.DB.prepare("SELECT n FROM quota_hits WHERE key = ? AND bucket = ?").bind(key, bucket).first();
    return { ok: (row?.n || 0) <= limit, n: row?.n || 0, limit };
  } catch (e) { return { ok: true, n: 0, limit, error: String(e.message || e).slice(0, 80) }; }
}
export async function ipKey(request) {
  const ip = request.headers.get("cf-connecting-ip") || "0";
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("ip:" + ip));
  return "ip:" + [...new Uint8Array(d)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}
export const LIMITS = { preview_ip: 120, preview_host: 60, signup_ip: 10, verify_host: 6 }; /* an hour; the release gates alone read one host dozens of times */
