// The fit loop: build, render, and when the renderer refuses pages over the blank limit, defer
// the image each short page pushed away and try again, up to three passes. The last pass
// tightens the image cap as well. Used by the press and by hand:
//   node -e 'import("./scripts/lib/fit.mjs").then(m => m.fit({ args: [...], html, pdf, log: console.log }))'
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function fit({ args, html, pdf, log = () => {}, passes = 3 }) {
  const sh = (cmd, a) => { try { return execFileSync(cmd, a, { stdio: ["ignore", "pipe", "inherit"] }).toString(); }
    catch (e) { const out = e.stdout ? e.stdout.toString().trim() : ""; if (out) console.error(out.split("\n").slice(-8).join("\n")); throw new Error(`${cmd} ${a.slice(0, 2).join(" ")} failed (exit ${e.status})`); } };
  const pagesFile = pdf.replace(/\.pdf$/, ".pages.json");
  const defer = new Set(); let extra = [];
  for (let pass = 1; pass <= passes; pass++) {
    const a = [...args, ...(defer.size ? ["--defer", [...defer].join(",")] : []), ...extra];
    log(`pass ${pass}: ${a.filter(x => !x.startsWith("--out") && !/\.html$/.test(x)).slice(1).join(" ")}`);
    sh("node", a);
    try { const out = sh("bash", ["scripts/render-book.sh", html, pdf]); return { ok: true, pass, defer: [...defer], out: out.trim() }; }
    catch (e) {
      let bad = []; try { bad = JSON.parse(readFileSync(pagesFile, "utf-8")).bad || []; } catch {}
      if (!bad.length) throw e; /* a failure that is not the detector stays a failure */
      log(`pass ${pass}: pages over the blank limit ${bad.map(b => `${b.page} (${Math.round(b.blank * 100)}%)`).join(", ")}`);
      const next = bad.map(b => b.defer).filter(Boolean).filter(id => !defer.has(id));
      if (!next.length && pass < passes) extra = ["--img-max", "2.6"]; /* nothing to defer: the cap is the last lever */
      next.forEach(id => defer.add(id));
      if (pass === passes) throw new Error(`${bad.length} page(s) still over the blank limit after ${passes} passes: ${bad.map(b => b.page).join(", ")}`);
      if (pass === passes - 1) extra = ["--img-max", "2.6"];
    }
  }
}
