// One environment contract for every outbound side effect. Production is explicit in GitHub;
// staging is mechanically different, not merely a different hostname.
export function runtimeMode(env = {}) {
  const value = String(env.INKSHEAF_ENV || "development").trim().toLowerCase();
  return value === "production" || value === "staging" ? value : "development";
}

export function isProduction(env = {}) {
  return runtimeMode(env) === "production";
}

export function stagingInbox(env = {}) {
  const value = String(env.STAGING_EMAIL || "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? value : null;
}

// Outside production, an email can only go to the allowlisted test inbox. No inbox means no
// send: callers fail visibly instead of falling through to the intended real address.
export function prepareOutboundEmail(env = {}, message = {}) {
  if (isProduction(env)) return { ...message };
  const inbox = stagingInbox(env);
  if (!inbox) throw new Error(`${runtimeMode(env)} email blocked: STAGING_EMAIL is not configured`);
  const intended = Array.isArray(message.to) ? message.to.join(", ") : String(message.to || "");
  return {
    ...message,
    to: [inbox],
    subject: `[${runtimeMode(env)}] ${String(message.subject || "")}`,
    text: `Intended recipient: ${intended}\n\n${String(message.text || "")}`,
  };
}

// The production press workflow does not listen to staging-* repository_dispatch events.
export function pressEventType(env = {}, event = "press") {
  const clean = String(event || "press").replace(/[^a-z-]/g, "").slice(0, 40) || "press";
  return isProduction(env) ? clean : `staging-${clean}`;
}

export function luluUsesProduction(env = {}) {
  return isProduction(env);
}
