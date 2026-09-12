import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {layoutInput,applyLayoutRepairs,pageContext,readingOrderFindings} from './publisher-layout.mjs';
import {reviewPdf,writerLine} from './page-review.mjs';
import {prepareLayoutEvidence} from './layout-evidence.mjs';
import {PUBLISHER_REVIEW_POLICY} from './publisher-session.mjs';
import {PUBLISHER_MAX_RENDERS,PUBLISHER_MAX_REPAIR_ROUNDS} from '../../functions/lib/publisher-policy.js';

// The same complete local pipeline is used by the press and by private rehearsals.
// Complete-file publication/email happen only after a checked PDF returns.
// An optional private draft excerpt may appear while that review continues.
export async function publishVolume({build,session,emit,volume,reviewDirectory,renderIdentity,log=()=>{},onRendered=async()=>{},onRestored=async()=>{}}){
  let usage=(await session()).renderUsage(volume),totalPasses=usage.passes,review,layout;
  let sourceHashes;
  const boundedBuild=async options=>{
    const remaining=PUBLISHER_MAX_RENDERS-totalPasses;
    if(remaining<1)throw Error('The bounded layout repairs need a closer look. Your work is saved.');
    let reservations=0,renderScope;
    const book=await build({...options,passes:Math.min(options.passes,remaining),beforePass:async settings=>{
      const publisher=await session();usage=await publisher.reserveRender(volume,settings);totalPasses=usage.passes;reservations++;
      if(renderIdentity)renderScope=publisher.renderScope(volume);
    }});
    if(reservations!==book.report.fit.pass)throw Error('Renderer did not account for every pass; the book is held for recovery.');
    const hashes=JSON.stringify(book.report.bodyHashes);
    if(sourceHashes!==undefined&&hashes!==sourceHashes)throw Error('Source text changed during layout repair; cannot finish this edition');
    sourceHashes=hashes;
    if(renderIdentity)await(await session()).saveRender(volume,book,renderIdentity,renderScope);
    return book;
  };
  let book=renderIdentity?await(await session()).loadRender(volume,renderIdentity):null;
  if(book)await onRestored(book);
  book||=await boundedBuild({passes:4});
  sourceHashes=JSON.stringify(book.report.bodyHashes);
  // Restore known paragraph boundaries before spending vision calls rediscovering
  // the same deterministic interruption. This is one bounded batch, not a loop.
  const firstMeasurement=JSON.parse(readFileSync(book.pdf.replace(/\.pdf$/,'.pages.json'),'utf8'));
  const interruptions=readingOrderFindings(firstMeasurement);
  if(interruptions.length){
    if(totalPasses>=PUBLISHER_MAX_RENDERS)throw Error('The bounded layout repairs need a closer look. Your work is saved.');
    const initial={...book.report.fit,inFlow:[...new Set([...(book.report.fit.inFlow||[]),...interruptions.map(f=>f.figure_id)])]};
    const available=PUBLISHER_MAX_RENDERS-totalPasses,passes=Math.min(2,Math.max(1,available-1));
    await emit({kind:'typesetting',volume,message:'Keeping photographs between the paragraphs that surround them in your original writing.'});
    book=await boundedBuild({initial,passes});
    if(JSON.stringify(book.report.bodyHashes)!==sourceHashes)throw Error('Source text changed during layout repair; cannot finish this edition');
    await emit({kind:'layout',volume,passes:totalPasses,decisions:interruptions.map(f=>({page:f.page,decision:'repair',candidate_id:`inflow:${f.figure_id}:${f.page}`,reason:'Kept this image between its original source paragraphs.'})),message:'Images have been placed back between their original paragraphs. The new pages will be checked.'});
  }
  for(let round=usage.repairs;round<=PUBLISHER_MAX_REPAIR_ROUNDS;round++){
    await emit({kind:'typesetting',volume,included:book.report.included,message:book.recovered?'The saved PDF is ready to continue its page checks.':round?'The adjusted pages have been typeset again.':'Your writing and images have been set on the page.'});
    await onRendered({book,round,volume});
    const publisher=await session();
    const measurement=JSON.parse(readFileSync(book.pdf.replace(/\.pdf$/,'.pages.json'),'utf8'));
    review=await reviewPdf(book.pdf,{ask:publisher.vision,imageFormat:"png",stopOnError:true,pageContext:pageContext(measurement,book.report),sourceFigures:measurement.figures||[],outDir:`${reviewDirectory}-${round}`,log});
    if(review.skipped||review.errors.length||!review.pages)throw Error('Page review could not finish. Your editorial work is saved for recovery.');
    review.measured_findings=readingOrderFindings(measurement);
    review.findings.push(...review.measured_findings);
    const measuredInput=layoutInput({measurement,report:book.report,fit:book.report.fit,review,pageText:execFileSync('pdftotext',['-layout',book.pdf,'-'],{encoding:'utf8',maxBuffer:20_000_000}).split('\f'),pdfHash:createHash('sha256').update(readFileSync(book.pdf)).digest('hex')});
    const evidence=prepareLayoutEvidence(measuredInput,{directory:`${reviewDirectory}-${round}`,rasterDirectory:`${reviewDirectory}-${round}/pages`,pageCount:review.pages,policy:PUBLISHER_REVIEW_POLICY});
    const input=evidence.input;
    try{layout=await publisher.layout(input,{imagesByPage:evidence.imagesByPage});}
    catch(error){evidence.saveResult({status:'incomplete'});throw error;}
    // Save before events, repair exhaustion or quality holds can interrupt work.
    evidence.saveResult({status:'completed-review',decisions:layout.decisions});
    await publisher.emit({kind:'layout',volume,pages:review.pages,passes:totalPasses,decisions:layout.decisions,message:layout.decisions.some(d=>d.decision==='repair')?'A few pages need a tighter setting. Their writing stays intact.':'Unused page space has been checked against the shape of each piece.'});
    // Apply available repairs before holding other findings: repagination can
    // resolve a neighbouring defect. Nothing clears until the new PDF is reviewed.
    if(!layout.decisions.some(d=>d.decision==='repair')){
      if(layout.decisions.some(d=>d.decision==='needs_review'))throw Error('The layout needs a closer look before the complete PDF is ready.');
      break;
    }
    if(usage.repairs>=PUBLISHER_MAX_REPAIR_ROUNDS||totalPasses>=PUBLISHER_MAX_RENDERS)throw Error('The bounded layout repairs need a closer look. Your work is saved.');
    const initial=applyLayoutRepairs(book.report.fit,layout,input);
    usage=await(await session()).reserveRepair(volume,initial);
    // A source-position repair can expose a new figure gap. Let the deterministic
    // fitter use otherwise-unused passes, while reserving a final repair round.
    const available=PUBLISHER_MAX_RENDERS-totalPasses;
    const passes=Math.min(3,Math.max(1,available-(round===0&&available>1?1:0)));
    book=await boundedBuild({initial,passes});
    if(JSON.stringify(book.report.bodyHashes)!==sourceHashes)throw Error('Source text changed during layout repair; cannot finish this edition');
  }
  // A measured, explained use of whitespace is recorded as a resolved finding.
  const intentional=new Set(layout.decisions.filter(d=>d.decision==='intentional_space').map(d=>d.page));
  review.layout_exceptions=layout.decisions.filter(d=>d.decision==='intentional_space');
  review.resolved=(review.findings||[]).filter(f=>f.check===1&&intentional.has(f.page));
  review.findings=(review.findings||[]).filter(f=>!review.resolved.includes(f));
  book.review=review;book.report.layoutAgent={decisions:layout.decisions,total_render_passes:totalPasses};
  await emit({kind:'review',volume,pages:review.pages,reviewed:true,message:writerLine(review)||'The page review is complete.',findings:review.findings.length});
  return book;
}
