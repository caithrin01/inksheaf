// The fit loop: build, render, and when the renderer refuses pages over the blank limit, defer
// the image each short page pushed away and try again, up to three passes. The last pass
// tightens the image cap as well. Used by the press and by hand:
//   node -e 'import("./scripts/lib/fit.mjs").then(m => m.fit({ args: [...], html, pdf, log: console.log }))'
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function fit({ args, html, pdf, log = () => {}, passes = 6 }) {
  const sh = (cmd, a) => { try { return execFileSync(cmd, a, { stdio: ["ignore", "pipe", "inherit"] }).toString(); }
    catch (e) { const out = e.stdout ? e.stdout.toString().trim() : ""; if (out) console.error(out.split("\n").slice(-8).join("\n")); throw new Error(`${cmd} ${a.slice(0, 2).join(" ")} failed (exit ${e.status})`); } };
  const pagesFile = pdf.replace(/\.pdf$/, ".pages.json");
  const defer = new Set(); let extra = []; const fitFigs = {};
  for (let pass = 1; pass <= passes; pass++) {
    const figArg = Object.keys(fitFigs).length ? ["--fit-figs", Object.entries(fitFigs).map(([k, v]) => `${k}=${v}`).join(",")] : [];
    const a = [...args, ...(defer.size ? ["--defer", [...defer].join(",")] : []), ...figArg, ...extra];
    log(`pass ${pass}: ${a.filter(x => !x.startsWith("--out") && !/\.html$/.test(x)).slice(1).join(" ")}`);
    sh("node", a);
    try {
      const out = sh("bash", ["scripts/render-book.sh", html, pdf]);
      /* Typst: a clean render may still name an essay tail whose figure has not been fitted yet;
         that is one more pass, and a figure is fitted once, so the loop cannot oscillate */
      let pj = {}; try { pj = JSON.parse(readFileSync(pagesFile, "utf-8")); } catch {}
      /* a figure may be fitted again only to a smaller height: the sequence is monotone, so it ends */
      const tails = pj.engine === "typst" ? (pj.fit || []).filter(f => f.closer && (!(f.id in fitFigs) || f.height <= fitFigs[f.id] - 0.1)) : [];
      if (tails.length && pass < passes) { for (const f of tails) fitFigs[f.id] = f.height; log(`pass ${pass}: clean; fitting essay tails ${tails.map(f => `${f.id} to ${f.height}in`).join(", ")}`); continue; }
      return { ok: true, pass, defer: [...defer], fitFigs: { ...fitFigs }, out: out.trim() };
    }
    catch (e) {
      let bad = [], pj = {}; try { pj = JSON.parse(readFileSync(pagesFile, "utf-8")); bad = pj.bad || []; } catch {}
      if (pj.engine === "typst" && !bad.length && (pj.fit || []).length) bad = (pj.fit || []).map(f => ({ page: f.page, blank: 0, closer: true }));
      if (!bad.length) throw e; /* a failure that is not the detector stays a failure */
      log(`pass ${pass}: ${bad.map(b => b.closer ? `${b.page} (closing page holds only a figure)` : `${b.page} (${Math.round(b.blank * 100)}%)`).join(", ")}`);
      if (pj.engine === "typst") {
        /* Typst: scale the figure that fell after each short page to the height that was left */
        const fits = (pj.fit || []).filter(f => !(f.id in fitFigs) || f.height <= fitFigs[f.id] - 0.1);
        if (!fits.length) throw new Error(`${bad.length} page(s) over the blank limit with no figure to fit: ${bad.map(b => b.page).join(", ")}`);
        for (const f of fits) fitFigs[f.id] = f.height;
        log(`pass ${pass}: fitting ${fits.map(f => `${f.id} to ${f.height}in`).join(", ")}`);
        if (pass === passes) throw new Error(`${bad.length} page(s) still over the blank limit after ${passes} passes: ${bad.map(b => b.page).join(", ")}`);
        continue;
      }
      const next = bad.map(b => b.defer).filter(Boolean).filter(id => !defer.has(id));
      if (!next.length && pass < passes) extra = ["--img-max", "2.6"]; /* nothing to defer: the cap is the last lever */
      next.forEach(id => defer.add(id));
      if (pass === passes) throw new Error(`${bad.length} page(s) still over the blank limit after ${passes} passes: ${bad.map(b => b.page).join(", ")}`);
      if (pass === passes - 1) extra = ["--img-max", "2.6"];
    }
  }
}
