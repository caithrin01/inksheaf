#!/usr/bin/env node
// Warm the inksheaf preview cache from THIS machine's IP (Substack accepts it; CF egress gets 429).
// Usage: node scripts/warm-preview.mjs https://pub1.com https://pub2.substack.com ...
// Mirrors functions/api/preview.js math exactly; drift between the two is a bug.
import { execFileSync } from "node:child_process";

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
  const recent = posts.filter(p => p && p.post_date && Date.parse(p.post_date) >= cutoff
    && (p.type === "newsletter" || p.type === "podcast" || !p.type));
  if (!recent.length) throw new Error("empty archive");
  const words = recent.reduce((s, p) => s + (Number(p.wordcount) || 0), 0);
  const dates = recent.map(p => Date.parse(p.post_date)).sort((a, b) => a - b);
  return { host,
    publication: pubName(recent, host),
    posts: recent.length, capped: posts.length >= MAX_POSTS, words,
    est_pages: Math.max(30, Math.round(words / 270 + recent.length * 1.0 + 10)),
    from: new Date(dates[0]).toISOString().slice(0, 10),
    to: new Date(dates[dates.length - 1]).toISOString().slice(0, 10),
    titles: recent.slice(0, 5).map(p => String(p.title || "").slice(0, 90)) };
}

function pubName(recent, host) {
  const names = {};
  for (const p of recent) for (const b of (p.publishedBylines || []))
    if (b?.name) names[b.name] = (names[b.name] || 0) + 1;
  const distinct = Object.keys(names);
  if (distinct.length === 1) return distinct[0];
  const label = host.replace(/^www\./, "").split(".")[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
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
