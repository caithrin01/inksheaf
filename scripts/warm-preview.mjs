#!/usr/bin/env node
// Warm the inksheaf preview cache from THIS machine's IP (Substack accepts it; CF egress gets 429).
// Usage: node scripts/warm-preview.mjs https://pub1.com https://pub2.substack.com ...
// Mirrors functions/api/preview.js math exactly; drift between the two is a bug.
import { execFileSync } from "node:child_process";
import { summarizeArchive } from "../functions/lib/preview-summary.js";

const MAX_POSTS = 150, WINDOW_DAYS = 366;

async function archive(host) {
  const posts = []; let hops = 0;
  const cutoff = Date.now() - WINDOW_DAYS * 864e5;
  for (let offset = 0; offset < MAX_POSTS; ) {
    const r = await fetch(`https://${host}/api/v1/archive?sort=new&offset=${offset}&limit=25`, {
      redirect: "manual", headers: { accept: "application/json", "user-agent": "Mozilla/5.0 inksheaf-warm/1.0" } });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location") || "";
      const u = new URL(loc.startsWith("http") ? loc : `https://${host}${loc}`);
      if (hops < 2 && u.hostname !== host) { hops++; host = u.hostname; continue; }
      throw new Error("redirect loop");
    }
    if (!r.ok) throw new Error("upstream " + r.status);
    const page = await r.json();
    if (!Array.isArray(page)) throw new Error("not an archive");
    if (!page.length) break;
    posts.push(...page);
    offset += page.length;
    if (page.length && Date.parse(page[page.length - 1].post_date || 0) < cutoff) break;
  }
  const identityPost = posts.find(p => p && p.post_date && Date.parse(p.post_date) >= cutoff
    && (p.type === "newsletter" || !p.type));
  if (!identityPost) throw new Error("empty archive");
  const identity = await theme(host, identityPost.slug);
  const summary = summarizeArchive(posts, identity, host, cutoff, posts.length >= MAX_POSTS);
  if (!summary) throw new Error("no public posts");
  return summary;
}

// mirrors functions/api/preview.js fetchTheme; drift between the two is a bug
async function theme(host, slug) {
  if (!slug) return { theme: null, publicationName: null };
  try {
    const r = await fetch(`https://${host}/api/v1/posts/${encodeURIComponent(slug)}`, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 inksheaf-warm/1.0" } });
    if (!r.ok) return { theme: null, publicationName: null };
    const post = await r.json();
    const publicationName = publicationNameFromPost(post, host);
    const tv = post?.themeVariables || {};
    const parse = c => {
      if (!c || typeof c !== "string") return null;
      const m = c.trim().match(/^#([0-9a-f]{6})$/i);
      if (m) { const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
      const g = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      return g ? [+g[1], +g[2], +g[3]] : null;
    };
    const lum = ([r2, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r2) + 0.7152 * f(g) + 0.0722 * f(b); };
    const contrast = (a, b) => { const [x, y] = [lum(a) + 0.05, lum(b) + 0.05]; return x > y ? x / y : y / x; };
    const hex = rgb => "#" + rgb.map(v => v.toString(16).padStart(2, "0")).join("");
    const bg = parse(tv.cover_bg_color || tv.web_bg_color);
    let ink = parse(tv.cover_print_primary || tv.print_on_pop);
    if (bg && !ink) ink = lum(bg) < 0.45 ? [255, 255, 255] : [34, 29, 22];
    if (!bg || !ink || contrast(bg, ink) < 4.5) return { theme: null, publicationName };
    return { publicationName, theme: { cover_bg: hex(bg), cover_ink: hex(ink),
      cover_ink2: lum(bg) < 0.45 ? "#d9d9d9" : "#5a554b",
      accent: tv.color_theme_accent || tv.background_pop || null,
      heading_stack: String(tv.font_family_headings_preset || "").slice(0, 200) || null } };
  } catch { return { theme: null, publicationName: null }; }
}

function publicationNameFromPost(post, host) {
  const pubs = [];
  for (const byline of (post?.publishedBylines || []))
    for (const user of (byline?.publicationUsers || []))
      if (user?.publication?.name) pubs.push(user.publication);
  const normalized = host.replace(/^www\./, "");
  const matched = pubs.find(p => String(p.custom_domain || "").replace(/^www\./, "") === normalized)
    || pubs.find(p => `${p.subdomain}.substack.com` === normalized)
    || pubs.find(p => p.id === post?.publication_id)
    || pubs[0];
  return matched?.name ? String(matched.name).slice(0, 120) : null;
}

for (const raw of process.argv.slice(2)) {
  const host = new URL(raw.includes("://") ? raw : "https://" + raw).hostname.toLowerCase();
  try {
    const data = await archive(host);
    const payload = JSON.stringify(data).replaceAll("'", "''");
    const sql = `INSERT INTO preview_cache (host, fetched_at, payload) VALUES ('${data.host}', datetime('now'), '${payload}') ` +
      `ON CONFLICT(host) DO UPDATE SET fetched_at=datetime('now'), payload=excluded.payload;` +
      (data.host === host ? "" :
        ` INSERT INTO preview_cache (host, fetched_at, payload) VALUES ('${host}', datetime('now'), '${payload}')` +
        ` ON CONFLICT(host) DO UPDATE SET fetched_at=datetime('now'), payload=excluded.payload;`);
    execFileSync("/opt/homebrew/bin/wrangler",
      ["d1", "execute", "inksheaf-beta", "--remote", "-y", "--command", sql],
      { cwd: new URL("..", import.meta.url).pathname, stdio: "pipe" });
    console.log("warmed", host, "->", data.est_pages, "pages,", data.posts, "posts");
  } catch (e) { console.log("FAILED", host, String(e.message || e)); }
}
