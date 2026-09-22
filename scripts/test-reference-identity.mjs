import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {emitTypst} from './lib/typst-emit.mjs';
import {queryMetadata} from './typst-metadata.mjs';
import {pageTextEvidence} from './lib/page-text-evidence.mjs';
import {referenceIdentity,adjudicateReferenceIdentity} from './lib/reference-identity.mjs';
import {reviewPdf} from './lib/page-review.mjs';
import {layoutInput,validateLayout} from './lib/publisher-layout.mjs';
const dir=mkdtempSync(resolve('proofs/reference-identity-'));
try{
 const html='<html><body><section class="article"><div class="arthead"><h2 class="arttitle">References</h2></div><div class="artbody"><p>Visit <a href="https://example.com/venue" data-link="aa">Roka Akor</a> for dinner.</p><div class="linknote"><ul><li><span class="lk">aa</span><span class="lk-text">Roka Akor</span><span class="lk-url">example.com/venue</span></li></ul></div><p>A complete ending.</p></div></section></body></html>';
 const typ=emitTypst(html,{baseDir:dir});
 const compile=(name,source)=>{const file=join(dir,name+'.typ'),pdf=join(dir,name+'.pdf');writeFileSync(file,source);execFileSync('typst',['compile','--font-path','fonts','--ignore-system-fonts',file,pdf],{stdio:'pipe'});return {file,pdf};};
 const original=compile('original',typ),meta=queryMetadata(original.file),measurement={print_elements:meta['print-element']};
 const marker=measurement.print_elements.find(e=>e.kind==='reference_marker'),page=marker.page,provenance=pageTextEvidence(measurement,page);
 assert(Number.isFinite(marker.x));assert.equal(provenance.reference_markers[0].x_points,marker.x);
 const identity=referenceIdentity(original.pdf,page,provenance.reference_markers);
 assert.equal(identity.markers[0].observed_label,'aa');assert.equal(identity.markers[0].identity_matches,true);
 const cases=[];
 for(const label of ['zz','z','aaa']){
  const changed=compile(label,typ.replace('#super[aa];','#super['+label+'];'));
  assert.notEqual(typ,typ.replace('#super[aa];','#super['+label+'];'));
  const actual=referenceIdentity(changed.pdf,page,provenance.reference_markers);
  assert.equal(actual.markers[0].observed_label,label);assert.equal(actual.markers[0].identity_matches,false);cases.push({...changed,label});
 }
 for(const refs of [[{label:'aa',y_points:marker.y}],[{label:'aa',x_points:marker.x+1,y_points:marker.y}],[{label:'aa',x_points:marker.x,y_points:marker.y+1}]])assert.equal(referenceIdentity(original.pdf,page,refs).markers[0].status,'unknown');
 assert.throws(()=>referenceIdentity(original.pdf,0,[]),/physical PDF page/);
 const duplicate=join(dir,'overlap.pdf');
 execFileSync('python3',['-c',`import pymupdf as fitz,sys
p=fitz.open(sys.argv[1]);p[int(sys.argv[3])-1].insert_text((float(sys.argv[4]),float(sys.argv[5])),"z",fontname="helv",fontsize=7);p.save(sys.argv[2])`,original.pdf,duplicate,String(page),String(marker.x),String(marker.y)]);
 assert.equal(referenceIdentity(duplicate,page,provenance.reference_markers).markers[0].status,'unknown');
 const unresolved={confirmed:true,origin:'rendered_layout',note:'The reference is unreadable.'};
 assert.deepEqual(adjudicateReferenceIdentity(unresolved,identity),unresolved);
 console.log('PASS actual compiled reference, shortened/extended/wrong labels, unknown positions and overlapping glyphs; matching text cannot dismiss a visual defect');
 for(const c of [{...original,label:'aa'},cases[0]]){
  const review=await reviewPdf(c.pdf,{outDir:join(dir,c.label+'-review'),textEvidence:p=>pageTextEvidence(measurement,p),ask:async({check,text})=>{
   if(!check){const first=Number(text.match(/top-left is page (\d+)/)[1]);return{text:JSON.stringify(page>=first&&page<first+4?[{page,check:6,confidence:1,note:'Check the reference after Roka Akor.'}]:[])};}
   assert(text.includes('printed_reference_identity'));return{text:JSON.stringify({confirmed:false,origin:'source_content',note:'The reference has a valid matching entry.'})};
  }});
  assert.equal(review.errors.length,0,JSON.stringify(review.errors));assert.equal(review.findings.length,c.label==='aa'?0:1);
  if(c.label==='aa'){assert.equal(review.dismissed.length,1);continue;}
  const finding=review.findings[0];assert.equal(finding.origin,'measured_layout');assert.equal(finding.defect,'reference_identity');assert.equal(finding.model_confirmation.confirmed,false);
  assert.equal(finding.text_evidence.printed_reference_identity.markers[0].observed_label,'zz');
  const input=layoutInput({measurement:{pages:[{page,blank:.7}]},report:{},fit:{},review});
  assert(input.pages[0].text_evidence.printed_reference_identity);
  assert.throws(()=>validateLayout({decisions:[{page,decision:'intentional_space',candidate_id:null,space_basis:'composition',reason:'The reference is intended.'}]},input),/content or overflow/);
 }
 console.log('PASS a false model approval is retained as evidence and overridden by an actual mismatch; layout cannot waive it');
}finally{rmSync(dir,{recursive:true,force:true});}
