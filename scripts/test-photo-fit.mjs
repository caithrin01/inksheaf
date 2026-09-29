// A closing photograph must actually move into the measured gap. Raster blank
// fractions include margins and can overestimate the usable space before it.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fitWithBudget} from './lib/fit.mjs';
import {publisherSession} from './lib/publisher-session.mjs';
const dir=mkdtempSync(resolve('proofs/photo-fit-')),oldEngine=process.env.BOOK_ENGINE;
try{
  execFileSync('python3',['-c',"from PIL import Image;import sys;Image.new('RGB',(1200,660),(150,100,70)).save(sys.argv[1])",join(dir,'photo.png')]);
  const html=join(dir,'book.html'),pdf=join(dir,'book.pdf'),builder=join(dir,'builder.mjs'),journal=join(dir,'journal');
  const typ=`#set page(width:6in,height:9in,margin:(inside:0.85in,outside:0.62in,top:0.78in,bottom:0.78in))
#set text(font:"Source Serif 4",size:10.5pt)
#set par(leading:0.66em,spacing:0.66em)
#show figure: set block(above:1em,below:1em)
#context [#metadata((n:1,page:here().page())) <artstart>]
OpeningMarker.
#pagebreak()
#v(365pt)
ClosingMarker keeps the original words before the photograph.

#figure([#context [#metadata((id:"photo",article:1,role:"picture",floating:false,page:here().page(),y:here().position().y.pt(),w:HEIGHT*1200/660,h:HEIGHT)) <fig>]#image("photo.png",height:HEIGHT*1pt)])
#context [#metadata((n:1,page:here().page())) <artend>]
`;
  writeFileSync(builder,`import {writeFileSync} from 'node:fs';
const args=process.argv.slice(2),i=args.indexOf('--fit-figs'),height=i<0?180.4752:Number(args[i+1].split('=')[1])*72;
if(args.includes('--fit-text'))throw Error('This regression must fit the picture without changing prose leading');
writeFileSync(${JSON.stringify(html)},'Synthetic photograph fixture');
writeFileSync(${JSON.stringify(html.replace('.html','.typ'))},${JSON.stringify(typ)}.replaceAll('HEIGHT',String(height)));
writeFileSync(${JSON.stringify(html.replace('.html','.report.json'))},JSON.stringify({printInterior:true}));`);
  process.env.BOOK_ENGINE='typst';const reservations=[];let before;
  const result=await fitWithBudget({args:[builder],html,pdf,passes:2,allowMeasuredSpaceReview:true,beforePass:async settings=>{
    if(reservations.length)before=JSON.parse(readFileSync(pdf.replace('.pdf','.pages.json')));
    await(await publisherSession({directory:journal,env:{}})).reserveRender('1',settings);reservations.push(structuredClone(settings));
  }});
  assert(before,'The first render must require a photograph fit');
  const after=JSON.parse(readFileSync(pdf.replace('.pdf','.pages.json'))),original=before.figures.find(f=>f.id==='photo'),fitted=after.figures.find(f=>f.id==='photo');
  console.log(JSON.stringify({before_page:original.page,after_page:fitted.page,height:fitted.h,estimated_gap:before.pages[original.page-2].blank*7.44*72,actual_gap:before.pages[original.page-2].layout_geometry.trailing_space_points}));
  assert.equal(fitted.page,original.page-1,'The reduced photograph must move onto the preceding page, not remain a smaller orphan');
  assert.equal(after.articles[0].end,before.articles[0].end-1,'The orphaned closing leaf must disappear');
  assert(fitted.h>=1.4*72,'Retain the existing minimum photograph size');
  assert.equal(result.pass,2);assert.equal(reservations.length,2);
  assert.deepEqual(result.fitText,{});
  assert.equal((await publisherSession({directory:journal,env:{}})).renderUsage('1').passes,2);
  const text=execFileSync('pdftotext',['-layout',pdf,'-'],{encoding:'utf8'});
  assert.equal(text.split('OpeningMarker').length-1,1);assert.equal(text.split('ClosingMarker').length-1,1);
  assert.equal(after.figures.length,1);
  console.log('PASS real two-render photograph fit uses physical free space, removes the orphan and preserves source markers and reservations');
}finally{
  if(oldEngine==null)delete process.env.BOOK_ENGINE;else process.env.BOOK_ENGINE=oldEngine;
  rmSync(dir,{recursive:true,force:true});
}
