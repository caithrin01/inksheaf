#!/usr/bin/env node
// Brand lift: the universal solver that reads a publication's own Substack theme
// (fonts, palette, marks the AUTHOR chose) and normalizes it into a print-safe brand object.
// Boundary: this lifts the WRITER's theme, never Substack-the-company's marks.
// Module: extractBrand(host). CLI: node scripts/brand-lift.mjs <host> [--out file.json]
//
// Sources, in order:
//   1. /api/v1/posts/<latest-slug> → themeVariables (colors, heading font preset + weight)
//   2. homepage window._preloads → pub.theme (font presets), logo_url, cover_photo_url, copyright
// Print safety: accent must hold >= 3:1 contrast on paper white or it is darkened stepwise;
// fonts map to embeddable OFL equivalents (system/commercial presets cannot ship in a PDF).

const UA = { "user-agent": "Mozilla/5.0 inksheaf-brand/1.0", accept: "application/json" };

/* ---------- font mapping: Substack preset family -> embeddable Google/OFL family ---------- */
// Families already on Google Fonts pass through; system/commercial ones map to close OFL matches.
const GOOGLE_OK = new Set([
  "Lora", "Merriweather", "EB Garamond", "Spectral", "Source Serif 4", "Source Serif Pro",
  "Inter", "Source Sans 3", "Source Sans Pro", "Libre Franklin", "Work Sans", "Karla",
  "Playfair Display", "PT Serif", "PT Sans", "Roboto", "Roboto Slab", "Open Sans",
  "IBM Plex Serif", "IBM Plex Sans", "IBM Plex Mono", "Bitter", "Crimson Pro", "Literata",
  "Newsreader", "Fraunces", "DM Serif Display", "DM Sans", "Libre Baskerville", "Domine",
  "Poppins", "Raleway", "Rubik", "Cardo", "Alegreya", "Vollkorn", "Courier Prime",
]);
const FONT_MAP = {
  "SF Pro Display": "Inter", "SF Pro Text": "Inter", "-apple-system": "Inter",
  "system-ui": "Inter", "BlinkMacSystemFont": "Inter", "Segoe UI": "Inter",
  "Helvetica": "Inter", "Helvetica Neue": "Inter", "Arial": "Inter",
  "Georgia": "Gelasio", "Times New Roman": "Tinos", "Times": "Tinos",
  "Palatino": "Vollkorn", "Book Antiqua": "Vollkorn", "Garamond": "EB Garamond",
  "Courier": "Courier Prime", "Courier New": "Courier Prime", "Menlo": "IBM Plex Mono",
  "Verdana": "Source Sans 3", "Trebuchet MS": "Source Sans 3", "Tahoma": "Source Sans 3",
  "GT Super": "Fraunces", "Freight Text": "Source Serif 4", "Untitled Sans": "Inter",
};
const MAPPABLE = new Set([...GOOGLE_OK, "Gelasio", "Tinos"]);

function firstFamily(stack) {
  if (!stack) return null;
  for (let f of String(stack).split(",")) {
    f = f.trim().replace(/^['"]|['"]$/g, "");
    if (!f || /^(serif|sans-serif|monospace|emoji|Apple Color Emoji|Segoe UI Emoji|Segoe UI Symbol)$/i.test(f)) continue;
    return f;
  }
  return null;
}
export function mapFont(stack, fallback) {
  const fam = firstFamily(stack);
  if (!fam) return { family: fallback, mappedFrom: null };
  if (MAPPABLE.has(fam) || GOOGLE_OK.has(fam)) return { family: fam, mappedFrom: null };
  if (FONT_MAP[fam]) return { family: FONT_MAP[fam], mappedFrom: fam };
  return { family: fallback, mappedFrom: fam };
}

/* ---------- color math for the print guard ---------- */
function parseColor(c) {
  if (!c || typeof c !== "string") return null;
  const hex = c.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) { const n = parseInt(hex[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  const rgb = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  return null;
}
const lum = ([r, g, b]) => {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => { const [x, y] = [lum(a) + 0.05, lum(b) + 0.05]; return x > y ? x / y : y / x; };
const toHex = ([r, g, b]) => "#" + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
const PAPER = [251, 247, 238];

export function printSafeAccent(color, fallback = "#a63a2b") {
  let rgb = parseColor(color);
  if (!rgb) return { color: fallback, adjusted: false };
  let darkened = false;
  for (let i = 0; i < 8 && contrast(rgb, PAPER) < 3; i++) { rgb = rgb.map(v => v * 0.82); darkened = true; }
  if (contrast(rgb, PAPER) < 3) return { color: fallback, adjusted: true };
  return { color: toHex(rgb), adjusted: darkened };
}

export function contrastHex(a, b) {
  const [x, y] = [parseColor(a), parseColor(b)];
  return x && y ? contrast(x, y) : 0;
}

/* ---------- extraction ---------- */
async function fetchText(url) {
  const r = await fetch(url, { headers: { ...UA, accept: "text/html" }, redirect: "follow" });
  return r.ok ? r.text() : "";
}
async function fetchJson(url) {
  const r = await fetch(url, { headers: UA, redirect: "follow" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

export async function extractBrand(host) {
  const brand = { host, source: [], warnings: [] };

  // 1. themeVariables via the newest post
  try {
    const arch = await fetchJson(`https://${host}/api/v1/archive?sort=new&offset=0&limit=5`);
    const slug = arch.find(p => p.audience === "everyone")?.slug || arch[0]?.slug;
    if (slug) {
      const post = await fetchJson(`https://${host}/api/v1/posts/${encodeURIComponent(slug)}`);
      const tv = post.themeVariables || {};
      if (Object.keys(tv).length) {
        brand.source.push("themeVariables");
        brand.accent_raw = tv.color_theme_accent || tv.background_pop || null;
        brand.cover_bg = tv.cover_bg_color || tv.web_bg_color || null;
        brand.cover_bg_secondary = tv.cover_bg_color_secondary || null;
        brand.cover_print = tv.cover_print_primary || tv.print_on_pop || null;
        brand.cover_print_secondary = tv.cover_print_secondary || null;
        brand.web_bg = tv.web_bg_color || null;
        brand.heading_stack = tv.font_family_headings_preset || null;
        brand.heading_weight = tv.font_weight_headings_preset || null;
      }
    }
  } catch (e) { brand.warnings.push("themeVariables unavailable: " + String(e.message).slice(0, 60)); }

  // 2. homepage preloads: logo, cover photo, copyright, body font preset
  try {
    const html = await fetchText(`https://${host}`);
    const m = html.match(/window\._preloads\s*=\s*JSON\.parse\("((?:[^"\\]|\\.)*)"\)/);
    if (m) {
      const pre = JSON.parse(JSON.parse(`"${m[1]}"`));
      const pub = pre.pub || {};
      brand.source.push("preloads");
      brand.publication_name = pub.name || null;
      brand.logo_url = pub.logo_url || null;
      brand.cover_photo_url = pub.cover_photo_url || null;
      brand.copyright = pub.copyright || null;
      const th = pub.theme || {};
      brand.body_stack = th.font_family_body || th.font_preset_body || null;
      if (!brand.heading_stack) brand.heading_stack = th.font_family_headings || th.font_preset_heading || null;
      if (!brand.accent_raw) brand.accent_raw = th.background_pop_color || null;
      if (!brand.cover_bg) brand.cover_bg = th.cover_bg_color || th.web_bg_color || null;
    }
  } catch (e) { brand.warnings.push("preloads unavailable: " + String(e.message).slice(0, 60)); }

  /* ---------- normalize to print-safe tokens ---------- */
  const accent = printSafeAccent(brand.accent_raw);
  brand.accent = accent.color;
  brand.accent_adjusted = accent.adjusted;

  const heading = mapFont(brand.heading_stack, "Source Serif 4");
  brand.heading_font = heading.family;
  brand.heading_font_mapped_from = heading.mappedFrom;
  brand.heading_weight = Number(brand.heading_weight) || 700;

  const body = mapFont(brand.body_stack, "Source Serif 4");
  // body text stays a book serif unless the publication chose an embeddable SERIF itself
  const SERIFS = new Set(["Lora", "Merriweather", "EB Garamond", "Spectral", "Source Serif 4",
    "Source Serif Pro", "Playfair Display", "PT Serif", "IBM Plex Serif", "Bitter", "Crimson Pro",
    "Literata", "Newsreader", "Fraunces", "Libre Baskerville", "Domine", "Cardo", "Alegreya",
    "Vollkorn", "Gelasio", "Tinos"]);
  brand.body_font = SERIFS.has(body.family) ? body.family : "Source Serif 4";
  brand.body_font_mapped_from = body.mappedFrom;

  // cover: use the publication's cover colors when present and self-consistent
  const bg = parseColor(brand.cover_bg);
  const ink = parseColor(brand.cover_print || "#ffffff");
  brand.cover_usable = !!(bg && ink && contrast(bg, ink) >= 3);
  if (!brand.cover_usable) brand.warnings.push("cover colors missing or low-contrast; neutral cover used");

  brand.fonts_css_url = "https://fonts.googleapis.com/css2?" + [...new Set([brand.heading_font, brand.body_font])]
    .map(f => "family=" + encodeURIComponent(f).replace(/%20/g, "+") + ":wght@400;600;700")
    .join("&") + "&display=swap";
  return brand;
}

/* ---------- CLI ---------- */
if (import.meta.url === `file://${process.argv[1]}`) {
  const host = new URL(process.argv[2].includes("://") ? process.argv[2] : "https://" + process.argv[2]).hostname;
  const brand = await extractBrand(host);
  const outIdx = process.argv.indexOf("--out");
  const out = outIdx > -1 ? process.argv[outIdx + 1] : null;
  if (out) (await import("node:fs")).writeFileSync(out, JSON.stringify(brand, null, 1));
  console.log(JSON.stringify(brand, null, 1));
}
