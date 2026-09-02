// Short links for print: inksheaf.com/l/<code>. The code is derived from the target, so the
// builder can print it without asking the database, and the press registers the rows after the
// build. Tracking parameters are stripped first so the same page always gets the same code.
// Design approved by Caithrin 2026-09-02 (plan-formatting-v1 section 7).
export function normalizeUrl(u) {
  try {
    const url = new URL(String(u).trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|action$|r$|s$|source$|mc_)/i.test(k)) url.searchParams.delete(k);
    url.hash = ""; url.hostname = url.hostname.toLowerCase();
    let s = url.toString(); if (s.endsWith("/") && url.pathname === "/") s = s.slice(0, -1);
    return s.replace(/\?$/, "");
  } catch { return null; }
}
export async function linkCode(target) {
  const data = new TextEncoder().encode(target);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; /* no 0, 1, i, l, o: read aloud from paper */
  let out = ""; for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
export const SHORT_HOST = "inksheaf.com/l/";
