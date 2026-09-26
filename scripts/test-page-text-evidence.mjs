import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {emitTypst} from './lib/typst-emit.mjs';
import {queryMetadata} from './typst-metadata.mjs';
import {pageTextEvidence} from './lib/page-text-evidence.mjs';
import {reviewPdf} from './lib/page-review.mjs';
import {layoutInput,validateLayout} from './lib/publisher-layout.mjs';
const dir=mkdtempSync(resolve('proofs/print-evidence-'));
try{
 const source=join(dir,'source.png');
 execFileSync('python3',['-c',`from PIL import Image,ImageDraw
import sys
im=Image.new('RGB',(1200,600),'white');ImageDraw.Draw(im).text((30,30),'Source image labels',fill='black');im.save(sys.argv[1])`,source]);
 const panel={source,image_sha256:createHash('sha256').update(readFileSync(source)).digest('hex'),index:1,row:1,first_column:1,last_column:2};
 const html='<html><body><section class="article"><div class="arthead"><h2 class="arttitle">Original writing</h2></div><div class="artbody"><p>As always, thank you for subscribing. Your support means the world to me!</p><p>Visit <a href="https://example.com/venue" data-link="aa">Roka Akor</a> for dinner.</p><figure><img src="source.png" data-fig="source-grid" alt="A reading image"></figure><div class="linknote"><ul><li><span class="lk">aa</span><span class="lk-text">Roka Akor</span><span class="lk-url">example.com/venue</span></li></ul></div><p>The complete ending of this substantive article.</p></div></section></body></html>';
 const typ=emitTypst(html,{baseDir:dir,sourceFigureRoles:{'source-grid':{role:'reading',image_sha256:panel.image_sha256,reading_detail:'small_text',grid:{columns:2,rows:1},detail_panels:[panel]}}});
 const baseline=typ.replace(/#context \[#metadata\(\(kind:.*?\)\)\s*<print-element>\]/g,'');
 assert.notEqual(typ,baseline);
 for(const [name,text] of [['evidence',typ],['baseline',baseline]]){
  writeFileSync(join(dir,name+'.typ'),text);
  execFileSync('typst',['compile','--font-path','fonts','--ignore-system-fonts',join(dir,name+'.typ'),join(dir,name+'.pdf')],{stdio:'pipe'});
 }
 execFileSync('python3',['-c',`import pymupdf as fitz,sys
a,b=[fitz.open(p) for p in sys.argv[1:]]
assert len(a)==len(b)
for x,y in zip(a,b):
 assert x.get_pixmap(dpi=72).samples==y.get_pixmap(dpi=72).samples
 assert x.get_text()==y.get_text()
`,join(dir,'baseline.pdf'),join(dir,'evidence.pdf')]);
 const meta=queryMetadata(join(dir,'evidence.typ'));
 const measurement={print_elements:meta['print-element'],paragraphs:meta.parstart.map(start=>({id:start.id,start,end:meta.parend.find(end=>end.id===start.id)}))};
 const marker=measurement.print_elements.find(e=>e.kind==='reference_marker'),caption=measurement.print_elements.find(e=>e.kind==='detail_caption');
 assert(marker&&caption);assert.equal(marker.text,'aa');
 const evidence=pageTextEvidence(measurement,marker.page);
 assert.equal(evidence.reference_markers[0].source_anchor,'Roka Akor');
 assert.equal(evidence.reference_markers[0].entry_match_count,1);assert(evidence.reference_markers[0].matching_entry.physical_page>=marker.page);
 assert(evidence.prepared_source_endings.some(p=>p.ending_fragment.includes('thank you for subscribing')));
 assert.equal(pageTextEvidence(measurement,caption.page).intended_print_text[0].text,'Enlarged detail 1 of 1 · row 1, columns 1–2');
 const withoutEntry={...measurement,print_elements:measurement.print_elements.filter(e=>e.kind!=='reference_entry')};
 assert.equal(pageTextEvidence(withoutEntry,marker.page).reference_markers[0].matching_entry,null);
 const wrongArticle={...measurement,print_elements:measurement.print_elements.map(e=>e.kind==='reference_entry'?{...e,article:e.article+1}:e)};
 assert.equal(pageTextEvidence(wrongArticle,marker.page).reference_markers[0].matching_entry,null);
 // An entry page reports its marker even when the marker is pages earlier in the article.
 const entryFirst={print_elements:[{kind:'reference_marker',text:'a',anchor:'slopstops.com',article:19,page:150,y:64.2},
  {kind:'reference_entry',text:'a',anchor:'slopstops.com',article:19,page:154,y:531.2},{kind:'reference_entry',text:'b',anchor:'md file',article:19,page:154,y:539.4}]};
 const onEntryPage=pageTextEvidence(entryFirst,154);
 assert.deepEqual(onEntryPage.reference_entries[0].matching_marker,{physical_page:150,y_points:64.2,anchor:'slopstops.com'});
 assert.equal(onEntryPage.reference_entries[1].matching_marker,null);assert.equal(onEntryPage.reference_entries[1].marker_match_count,0);
 assert.equal(pageTextEvidence({print_elements:entryFirst.print_elements.map(e=>e.kind==='reference_marker'?{...e,article:20}:e)},154).reference_entries[0].matching_marker,null);
 assert.equal(pageTextEvidence({},1),null);assert.throws(()=>pageTextEvidence({},0),/physical PDF page/);
 console.log('PASS compiled references, exact reader caption and source fragments; missing or unrelated reference entries stay unknown; every page remains pixel/text-identical');
 let evidenceCalls=0,confirmations=0;
 const review=await reviewPdf(join(dir,'evidence.pdf'),{outDir:join(dir,'review'),textEvidence:page=>{evidenceCalls++;return pageTextEvidence(measurement,page);},ask:async request=>{
  if(!request.check){assert(!request.text.includes('prepared_source_endings'));const first=Number(request.text.match(/top-left is page (\d+)/)[1]);return {text:JSON.stringify([{page:marker.page,check:6,confidence:1,note:'Inspect the reference glyph.'},{page:caption.page,check:7,confidence:1,note:'Inspect extra markup beside the caption.'}].filter(f=>f.page>=first&&f.page<first+4))};}
  confirmations++;assert(request.text.includes('text_evidence:'));assert(request.images.length<=4);
  return {text:JSON.stringify({confirmed:request.check===7,origin:'rendered_layout',note:request.check===7?'An unrelated introduced markup defect remains held.':'The declared reference is legible and has its printed entry.'})};
 }});
 assert.equal(evidenceCalls,2);assert.equal(confirmations,2);assert.equal(review.errors.length,0);
 assert.equal(review.findings.length,1);assert.equal(review.findings[0].check,7);assert(review.findings[0].text_evidence);
 assert.equal(review.dismissed.length,1);assert(review.dismissed[0].text_evidence);
 const page=caption.page,input=layoutInput({measurement:{pages:[{page,blank:.7}]},report:{},fit:{},review});
 assert(input.pages[0].text_evidence);assert(input.pages[0].findings.some(f=>f.check===7));
 assert.throws(()=>validateLayout({decisions:[{page,decision:'intentional_space',candidate_id:null,space_basis:'composition',reason:'The expected caption is intentional.'}]},input),/content or overflow/);
 console.log('PASS evidence only enters targeted confirmations; renderer intent never overrides a held extra-markup finding or clears layout');
}finally{if(process.env.INKSHEAF_KEEP_PRINT_EVIDENCE)console.log('Fixture retained at '+dir);else rmSync(dir,{recursive:true,force:true});}
