// The fit loop: build, render, and when the renderer refuses pages over the blank limit, defer
// the image each short page pushed away and try again, up to three passes. The last pass
// tightens the image cap as well. Used by the press and by hand:
//   node -e 'import("./scripts/lib/fit.mjs").then(m => m.fit({ args: [...], html, pdf, log: console.log }))'
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {readingOrderFindings} from './publisher-layout.mjs';

export function fit(options) {
  const steps = fitPasses(options);
  let step;
  do { step = steps.next(); } while (!step.done);
  return step.value;
}

// The publisher reserves a pass durably before any child builder can run. Legacy
// tools retain the synchronous entry point, using the very same fitting loop.
export async function fitWithBudget({ beforePass, ...options }) {
  if (typeof beforePass !== 'function') throw Error('Publisher fit requires durable render accounting');
  const steps = fitPasses(options);
  try {
    for (;;) {
      const step = steps.next();
      if (step.done) return step.value;
      await beforePass(step.value);
    }
  } finally { steps.return(); }
}

function* fitPasses({ args, html, pdf, log = () => {}, passes = 10, initial = {}, allowMeasuredSpaceReview = false }) {
  const sh = (cmd, a) => { try { return execFileSync(cmd, a, { stdio: ["ignore", "pipe", "inherit"] }).toString(); }
    catch (e) { const out = e.stdout ? e.stdout.toString().trim() : ""; if (out) console.error(out.split("\n").slice(-8).join("\n")); throw Object.assign(new Error(`${cmd} ${a.slice(0, 2).join(" ")} failed (exit ${e.status})`),{exitStatus:e.status,output:out}); } };
  const pagesFile = pdf.replace(/\.pdf$/, ".pages.json");
  const defer = new Set(initial.defer || []), backLinks = new Set(initial.backLinks || []), inFlow = [...(initial.inFlow || [])];
  let extra = []; const fitFigs = {...initial.fitFigs}, fitText = {...initial.fitText}, readingFigures={...initial.readingFigures}, pictureFigures=[...(initial.pictureFigures||[])];
  for (let pass = 1; pass <= passes; pass++) {
    yield { pass, defer: [...defer], fitFigs: { ...fitFigs }, fitText: { ...fitText }, backLinks: [...backLinks], inFlow: [...inFlow], readingFigures: { ...readingFigures }, pictureFigures:[...pictureFigures], extra: [...extra] };
    const figArg = Object.keys(fitFigs).length ? ["--fit-figs", Object.entries(fitFigs).map(([k, v]) => `${k}=${v}`).join(",")] : [];
    const textArg = Object.keys(fitText).length ? ['--fit-text', Object.entries(fitText).map(([n,v])=>`${n}=${v}`).join(',')] : [];
    const a = [...args, ...(defer.size ? ["--defer", [...defer].join(",")] : []), ...figArg, ...textArg,
      ...(backLinks.size ? ['--back-links', [...backLinks].join(',')] : []), ...(inFlow.length ? ['--in-flow', inFlow.join(',')] : []), ...(pictureFigures.length?['--picture-figures',pictureFigures.join(',')]:[]), ...(Object.keys(readingFigures).length?['--reading-figures',Object.entries(readingFigures).map(([id,mode])=>`${id}=${mode}`).join(',')]:[]), ...extra];
    log(`pass ${pass}: ${a.filter(x => !x.startsWith("--out") && !/\.html$/.test(x)).slice(1).join(" ")}`);
    sh("node", a);
    try {
      let out,spacePending=false;
      try{out=sh("bash", ["scripts/render-book.sh", html, pdf]);}
      catch(error){
        // Only the explicit spacing-only exit can enter mandatory publisher
        // review. Compile, glyph, measurement and other failures still stop.
        if(!allowMeasuredSpaceReview||error.exitStatus!==4)throw error;
        out=error.output;spacePending=true;
      }
      let pj = {}; try { pj = JSON.parse(readFileSync(pagesFile, "utf-8")); } catch {}
      if(spacePending&&(pj.engine!=='typst'||!pj.pages?.length||!pj.bad?.length||pj.pages.some(p=>!p.layout_geometry)))throw Error('Spacing review requires complete measured pages');
      // Batch independent measured repairs into the next reserved render. Previously
      // each category continued the loop immediately; reference tails waited behind
      // every leading adjustment and could consume the whole allowance unchanged.
      const interruptions=pj.engine==='typst'?readingOrderFindings(pj).filter(f=>!inFlow.includes(f.figure_id)):[];
      const tails = pj.engine === "typst" ? (pj.fit || []).filter(f => (!allowMeasuredSpaceReview||pj.figures?.find(x=>x.id===f.id)?.role==='picture') && !readingFigures[f.id] && (spacePending||f.closer || f.opener) && (!(f.id in fitFigs) || f.height <= fitFigs[f.id] - 0.1)) : [];
      const stranded = pj.engine === 'typst' ? (pj.articles || []).filter(a=>!backLinks.has(a.n) && a.end>a.start &&
        pj.pages[a.end-1]?.ink_rows < .25 && pj.linkStarts?.some(l=>l.n===a.n&&l.page>=a.end-1)) : [];
      // Bring a very sparse ending back by adjusting leading, never font size, within
      // 0.12em (1.26pt). A finite, monotone sequence avoids oscillating pagination.
      // Article boundaries remain; any tail that cannot fit stays flagged for visual review.
      const sparse = pj.engine === 'typst' ? (pj.articles || []).filter(a=>a.end>a.start &&
        pj.pages[a.end-1]?.ink_rows < .25 && (fitText[a.n] || .66) > .54 &&
        !stranded.some(s=>s.n===a.n) && !tails.some(f=>f.page>=a.start&&f.page<=a.end) &&
        !interruptions.some(f=>f.page>=a.start&&f.page<=a.end)) : [];
      if ((interruptions.length||tails.length||stranded.length||sparse.length) && pass < passes) {
        for(const f of interruptions)if(!inFlow.includes(f.figure_id))inFlow.push(f.figure_id);
        for(const f of tails)fitFigs[f.id]=f.height;
        stranded.forEach(a=>backLinks.add(a.n));
        for (const a of sparse) fitText[a.n] = Math.max(.54, +((fitText[a.n] || .66) - .04).toFixed(2));
        log(`pass ${pass}: preparing ${interruptions.length} source-position, ${tails.length} figure, ${stranded.length} reference and ${sparse.length} leading repairs together`);
        continue;
      }
      return { ok: true, pass, defer: [...defer], fitFigs: { ...fitFigs }, fitText: {...fitText}, backLinks:[...backLinks], inFlow, readingFigures, pictureFigures, ...(spacePending?{spacing_requires_review:true}:{}), out: out.trim() };
    }
    catch (e) {
      let bad = [], pj = {}; try { pj = JSON.parse(readFileSync(pagesFile, "utf-8")); bad = pj.bad || []; } catch {}
      if (pj.engine === "typst" && !bad.length && (pj.fit || []).length) bad = (pj.fit || []).map(f => ({ page: f.page, blank: 0, closer: true }));
      if (!bad.length) throw e; /* a failure that is not the detector stays a failure */
      log(`pass ${pass}: ${bad.map(b => b.closer ? `${b.page} (closing page holds only a figure)` : `${b.page} (${Math.round(b.blank * 100)}%)`).join(", ")}`);
      if (pj.engine === "typst") {
        // A whitespace failure still has usable source-position measurements.
        // Share its next reserved render instead of postponing all float repairs
        // until whitespace happens to pass and the allowance is nearly gone.
        for(const f of readingOrderFindings(pj))if(!inFlow.includes(f.figure_id))inFlow.push(f.figure_id);
        /* Typst: scale the figure that fell after each short page to the height that was left */
        const fits = (pj.fit || []).filter(f => !readingFigures[f.id] && (!(f.id in fitFigs) || f.height <= fitFigs[f.id] - 0.1));
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
