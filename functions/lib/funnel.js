// One small, first-party funnel ledger: public publication host + random browser session only.
// The signup row remains the sole home of the writer's email. Owner alerts are opt-in through
// FUNNEL_ALERT_EMAIL and use the same staging fail-closed rule as every other outbound email.
import { prepareOutboundEmail } from "./runtime.js";

const EVENTS = new Set(["preview_ok", "preview_fail", "reserve_start", "signup", "verified"]);
const STAMP = {
  preview_ok: "preview_ok_at",
  preview_fail: "preview_failed_at",
  reserve_start: "reserve_started_at",
  signup: "signup_at",
  verified: "verified_at",
};
const ALERT = { preview_ok: "alerted_preview_at", signup: "alerted_signup_at", verified: "alerted_verified_at" };

export function funnelSession(value) {
  const s = String(value || "").toLowerCase().slice(0, 16);
  return /^[a-z0-9]{6,16}$/.test(s) ? s : null;
}

export function funnelHost(value) {
  let u;
  try { u = new URL(String(value || "").includes("://") ? String(value) : "https://" + String(value)); }
  catch { return null; }
  const h = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(h)) return null;
  return h;
}

const changes = r => Number(r?.meta?.changes || r?.changes || 0);

export async function recordFunnel(env, input = {}) {
  const event = String(input.event || "");
  const signupId = Number(input.signup_id) || null;
  const host = funnelHost(input.host);
  const session = funnelSession(input.session) || (signupId ? funnelSession(`signup${signupId}`) : null);
  if (!env?.DB || !EVENTS.has(event) || !host || !session) return { ok: false, alert: false };

  const stamp = STAMP[event];
  await env.DB.prepare(`INSERT INTO funnel_sessions (session, host, last_event, ${stamp}, signup_id)
    VALUES (?, ?, ?, datetime('now'), ?)
    ON CONFLICT(session, host) DO UPDATE SET
      updated_at = datetime('now'), last_event = excluded.last_event,
      ${stamp} = COALESCE(funnel_sessions.${stamp}, excluded.${stamp}),
      signup_id = COALESCE(excluded.signup_id, funnel_sessions.signup_id)`)
    .bind(session, host, event, signupId).run();

  const alertColumn = ALERT[event];
  const alertTo = String(env.FUNNEL_ALERT_EMAIL || "").trim().toLowerCase();
  if (!alertColumn || input.automated || !env.RESEND_API_KEY || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(alertTo))
    return { ok: true, alert: false, session, host };

  // A preview alert is only allowed for a host the server has actually read and cached. This
  // stops the public event endpoint becoming an arbitrary-email trigger.
  if (event === "preview_ok") {
    const cached = await env.DB.prepare("SELECT host FROM preview_cache WHERE host IN (?, ?) LIMIT 1")
      .bind(host, `www.${host}`).first().catch(() => null);
    if (!cached) return { ok: true, alert: false, session, host };
  }
  const recent = await env.DB.prepare(`SELECT count(*) n FROM funnel_sessions WHERE ${alertColumn} > datetime('now','-1 hour')`)
    .first().catch(() => ({ n: 0 }));
  if ((recent?.n || 0) >= 20) return { ok: true, alert: false, session, host };
  const claimed = await env.DB.prepare(`UPDATE funnel_sessions SET ${alertColumn} = datetime('now')
    WHERE session = ? AND host = ? AND ${alertColumn} IS NULL`).bind(session, host).run();
  return { ok: true, alert: changes(claimed) === 1, session, host, signup_id: signupId };
}

export async function recordVerifiedFunnel(env, signupId) {
  const id = Number(signupId);
  if (!env?.DB || !id) return { ok: false, alert: false };
  const row = await env.DB.prepare("SELECT session, host FROM funnel_sessions WHERE signup_id = ? ORDER BY updated_at DESC LIMIT 1")
    .bind(id).first().catch(() => null);
  if (!row) return { ok: false, alert: false };
  return recordFunnel(env, { session: row.session, host: row.host, signup_id: id, event: "verified" });
}

export async function sendFunnelAlert(env, details = {}) {
  const to = String(env.FUNNEL_ALERT_EMAIL || "").trim().toLowerCase();
  if (!details.alert || !env.RESEND_API_KEY || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { sent: false, reason: "disabled" };
  const stage = String(details.stage || "preview_ok");
  const host = funnelHost(details.host) || "unknown publication";
  const title = stage === "signup" ? "Reservation started" : stage === "verified" ? "Publication verified" : "New book preview";
  const next = stage === "preview_ok" ? "They have not reserved yet. A later email will say if they do."
    : stage === "signup" ? "They reserved and are waiting for publication verification."
    : `Verification completed; press status: ${details.press || "recorded"}.`;
  const lines = [title, "", `Publication: ${host}`, `Funnel: ${details.session || "—"}`];
  if (details.signup_id) lines.push(`Signup: ${details.signup_id}`);
  if (stage === "signup" && details.email) lines.push(`Email: ${details.email}`);
  lines.push("", next, "", "No IP address or archive content is stored in this funnel.");
  let message;
  try {
    message = prepareOutboundEmail(env, { from: "Inksheaf <press@inksheaf.com>", to: [to], reply_to: "caithrin@caithrin.com",
      subject: `${title}: ${host}`, text: lines.join("\n") });
  } catch (e) { return { sent: false, reason: String(e?.message || e) }; }
  const r = await fetch("https://api.resend.com/emails", { method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify(message) });
  return { sent: r.ok, status: r.status };
}

export function scheduleFunnelAlert(waitUntil, env, details) {
  const work = sendFunnelAlert(env, details).catch(() => ({ sent: false }));
  if (typeof waitUntil === "function") { waitUntil(work); return; }
  return work;
}
