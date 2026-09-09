import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {layoutInput,applyLayoutRepairs,pageContext,readingOrderFindings} from './publisher-layout.mjs';
import {reviewPdf,writerLine} from './page-review.mjs';

// The same complete local pipeline is used by the press and by private rehearsals.
// Complete-file publication/email happen only after a checked PDF returns.
// An optional private draft excerpt may appear while that review continues.
export async function publishVolume({build,session,emit,volume,reviewDirectory,log=()=>{},onRendered=async()=>{}}){
  let book=await build({passes:4}),totalPasses=book.report.fit.pass,review,layout;
  const sourceHashes=JSON.stringify(book.report.bodyHashes);
  for(let round=0;round<=2;round++){
    await emit({kind:'typesetting',volume,included:book.report.included,message:round?'The adjusted pages have been typeset again.':'Your writing and images have been set on the page.'});
    await onRendered({book,round,volume});
    const publisher=await session();
    const measurement=JSON.parse(readFileSync(book.pdf.replace(/\.pdf$/,'.pages.json'),'utf8'));
    review=await reviewPdf(book.pdf,{ask:publisher.vision,imageFormat:"png",stopOnError:true,pageContext:pageContext(measurement,book.report),sourceFigures:measurement.figures||[],outDir:`${reviewDirectory}-${round}`,log});
    if(review.skipped||review.errors.length||!review.pages)throw Error('Page review could not finish. Your editorial work is saved for recovery.');
    review.measured_findings=readingOrderFindings(measurement);
    review.findings.push(...review.measured_findings);
    const input=layoutInput({measurement,report:book.report,fit:book.report.fit,review,pageText:execFileSync('pdftotext',['-layout',book.pdf,'-'],{encoding:'utf8',maxBuffer:20_000_000}).split('\f'),pdfHash:createHash('sha256').update(readFileSync(book.pdf)).digest('hex')});
    layout=await publisher.layout(input);
    await publisher.emit({kind:'layout',volume,pages:review.pages,passes:totalPasses,decisions:layout.decisions,message:layout.decisions.some(d=>d.decision==='repair')?'A few pages need a tighter setting. Their writing stays intact.':'Unused page space has been checked against the shape of each piece.'});
    // Apply available repairs before holding other findings: repagination can
    // resolve a neighbouring defect. Nothing clears until the new PDF is reviewed.
    if(!layout.decisions.some(d=>d.decision==='repair')){
      if(layout.decisions.some(d=>d.decision==='needs_review'))throw Error('The layout needs a closer look before the complete PDF is ready.');
      break;
    }
    if(round===2||totalPasses>=6)throw Error('The bounded layout repairs need a closer look. Your work is saved.');
    const initial=applyLayoutRepairs(book.report.fit,layout,input);
    // A source-position repair can expose a new figure gap. Let the deterministic
    // fitter use otherwise-unused passes, while reserving a final repair round.
    const passes=Math.min(3,6-totalPasses-(round===0?1:0));
    book=await build({initial,passes});totalPasses+=book.report.fit.pass;
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
