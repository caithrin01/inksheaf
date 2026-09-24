import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {auditRunningMatter} from './lib/running-matter.mjs';
import {reviewPdf} from './lib/page-review.mjs';
const dir=mkdtempSync(join(tmpdir(),'inksheaf-heads-')),doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.TimesRomanItalic);
for(const [head,folio] of [['CAITHRIN','4'],['Wrong essay','5'],['',''],['','7']]){
 const p=doc.addPage([432,648]);if(head)p.drawText(head,{x:48,y:610,size:8,font});if(folio)p.drawText(folio,{x:210,y:35,size:8,font});p.drawText('The complete body text stays inside its column.',{x:48,y:540,size:11,font});
}
const pdf=join(dir,'heads.pdf');writeFileSync(pdf,await doc.save());
const context=['caithrin','Right essay',null,null].map((head,i)=>({page:i+1,running_head_map_available:true,folio_map_available:true,expected_running_head:head,expected_printed_folio:[4,5,null,null][i]}));
const rows=auditRunningMatter(pdf,context);
assert.deepEqual(rows.map(p=>p.verified),[true,false,true,false]);
assert.equal(rows[1].head_matches,false);assert.equal(rows[3].folio_matches,false);
assert.deepEqual(auditRunningMatter(pdf,[{page:1,running_head_map_available:true}]),[]);
let confirmations=0;
const review=await reviewPdf(pdf,{outDir:join(dir,'review'),pageContext:context,ask:async({text})=>{
 if(text.includes('contact sheet'))return {text:JSON.stringify([{page:1,check:5,confidence:1,note:'Should be bold rather than italic'},{page:2,check:5,confidence:1,note:'Wrong title'}])};
 confirmations++;throw Error('Deterministic labels require no paid confirmation');
}});
assert.equal(confirmations,0);assert.equal(review.errors.length,0);
assert.deepEqual(review.findings.map(f=>[f.page,f.check]),[[2,5],[4,5]]);
assert.equal(review.dismissed[0].page,1);
// Use the actual print font and tracking: normal extraction inserts a synthetic
// space in "knowledge". An explicitly encoded extra space must still fail.
const trackedTyp=join(dir,'tracked.typ'),trackedPdf=join(dir,'tracked.pdf');
writeFileSync(trackedTyp,`#set page(width: 6in, height: 9in, margin: (top: 0.78in, bottom: 0.78in, x: 0.62in))
#set text(font: "Source Serif 4")
#set page(header: text(size: 7.5pt, tracking: 0.14em)[#smallcaps[fabricated knowledge]])
The first body.
#pagebreak()
#set page(header: text(size: 7.5pt, tracking: 0.14em)[#smallcaps[fabricated knowled ge]])
The second body.
`);
execFileSync('typst',['compile','--font-path','fonts','--ignore-system-fonts',trackedTyp,trackedPdf]);
const trackedContext=[1,2].map(page=>({page,running_head_map_available:true,folio_map_available:true,expected_running_head:'Fabricated Knowledge',expected_printed_folio:null}));
const tracked=auditRunningMatter(trackedPdf,trackedContext);
assert.deepEqual(tracked.map(p=>p.verified),[true,false]);
assert.equal(tracked[0].actual_head,'fabricated knowledge');
assert.equal(tracked[1].actual_head,'fabricated knowled ge','Encoded word boundaries must not be erased');
console.log('PASS actual PDF heads and folios: correct labels, wrong title, unexpected folio, blank front matter, missing maps, no paid false confirmation');
console.log('PASS tracked small caps ignore synthetic extraction spaces while retaining real word-boundary defects');
