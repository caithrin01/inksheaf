// Seeded random draw of publications from Substack's public category listings, shared by
// the random battery and the editor eval. Extracted 2026-09-01 from test-random-substacks.mjs.
const UA = "Mozilla/5.0 (Macintosh) inksheaf-random-battery/1.0 (+https://inksheaf.com)";
export const CATEGORIES = [96, 4, 62, 76739, 153, 13645, 94, 15417, 76740, 76741, 103, 49715, 11, 223, 15414, 134,
  339, 284, 355, 61, 109, 1796, 114, 387, 51282, 118, 18, 49692, 34, 76782, 76866];
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export async function fetchWithBackoff(url, opts = {}) {
  let last;
  for (const wait of [0, 4000, 8000, 16000]) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    const r = await fetch(url, { ...opts, headers: { "user-agent": UA, accept: "application/json", ...(opts.headers || {}) } });
    if (r.status !== 429 && r.status < 500) return r;
    last = r;
  }
  return last;
}
export async function drawSample(n, seed) {
  const rand = rng(seed), pick = arr => arr[Math.floor(rand() * arr.length)];
  const seen = new Set(), out = [];
  let draws = 0;
  while (out.length < n && draws < n * 6) {
    draws++;
    const cat = pick(CATEGORIES), page = Math.floor(rand() * 13);
    let pubs;
    try { const r = await fetchWithBackoff(`https://substack.com/api/v1/category/public/${cat}/all?page=${page}`); pubs = (await r.json()).publications || []; }
    catch { continue; }
    if (!pubs.length) continue;
    const p = pick(pubs);
    const host = (p.custom_domain || `${p.subdomain}.substack.com`).toLowerCase();
    if (seen.has(host)) continue;
    seen.add(host);
    out.push({ host, name: p.name, category: cat, custom: !!p.custom_domain });
  }
  return out;
}
/* Direct archive read, newest first, paging by the count received, back to `untilIso`. */
export async function readArchive(host, { maxPosts = 150, untilIso = "1970-01-01" } = {}) {
  const posts = [];
  for (let offset = 0; posts.length < maxPosts; ) {
    const r = await fetchWithBackoff(`https://${host}/api/v1/archive?sort=new&offset=${offset}&limit=25`);
    if (!r.ok) throw new Error(`archive ${r.status}`);
    const page = await r.json();
    if (!Array.isArray(page) || !page.length) break;
    posts.push(...page);
    offset += page.length;
    if (String(page[page.length - 1].post_date || "").slice(0, 10) < untilIso) break;
  }
  return posts.slice(0, maxPosts);
}
