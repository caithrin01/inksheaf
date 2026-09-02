// After a reservation: start the press (a GitHub Actions run) that builds the proof pages and
// emails them. The Pages Function cannot run Chromium; the workflow can. Without a token the
// reservation still lands and the press is started by hand from the operator email.
export async function dispatchPress(env, payload) {
  if (!env.GITHUB_DISPATCH_TOKEN) return { ok: false, reason: "no dispatch token" };
  const repo = env.PRESS_REPO || "caithrin01/inksheaf";
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, accept: "application/vnd.github+json",
        "content-type": "application/json", "user-agent": "inksheaf-press/1.0" },
      body: JSON.stringify({ event_type: payload.event || "press", client_payload: payload }),
    });
    return { ok: r.status === 204, status: r.status };
  } catch (e) { return { ok: false, reason: String(e.message || e).slice(0, 120) }; }
}

/* HMAC over a message, hex; the same shape the relay signatures use */
export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function signApproval(secret, signupId) { return hmacHex(secret, `approve:${signupId}`); }
