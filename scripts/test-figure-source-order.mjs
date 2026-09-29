// Actual source order versus printed order: the first figure must not float
// beyond later sections merely because it is outside every paragraph's span.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {emitTypst} from './lib/typst-emit.mjs';
import {readingOrderFindings} from './lib/publisher-layout.mjs';
import {fitWithBudget} from './lib/fit.mjs';
import {publisherSession} from './lib/publisher-session.mjs';
mkdirSync('proofs',{recursive:true});const dir=mkdtempSync(resolve('proofs/figure-source-order-')),oldEngine=process.env.BOOK_ENGINE;
try{
  execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(300,90),(180,100,90)).save(sys.argv[1])",join(dir,'figure.png')]);
  const source='<html><body><section class="article"><header class="arthead"><h2 class="arttitle">Tool comparisons</h2></header><div class="artbody"><h3>FirstToolMarker</h3><figure><img src="figure.png" data-fig="first" alt="screenshot"/></figure><p>FirstBodyMarker explains the screenshot belonging to the first tool.</p><h3>LaterToolMarker</h3><p>LaterBodyMarker belongs to a different tool and must follow that first image.</p><figure><img src="figure.png" data-fig="last" alt="screenshot"/></figure><p>EndMarker keeps all source text and both images.</p></div></section></body></html>';
  const html=join(dir,'book.html'),pdf=join(dir,'book.pdf'),builder=join(dir,'builder.mjs'),journal=join(dir,'journal');
  writeFileSync(builder,`import {writeFileSync} from 'node:fs';import {emitTypst} from ${JSON.stringify(new URL('./lib/typst-emit.mjs',import.meta.url).href)};
const args=process.argv.slice(2),i=args.indexOf('--in-flow'),inFlow=i<0?[]:args[i+1].split(',');
writeFileSync(${JSON.stringify(html)},${JSON.stringify(source)});
writeFileSync(${JSON.stringify(html.replace('.html','.typ'))},emitTypst(${JSON.stringify(source)},{baseDir:${JSON.stringify(dir)},pubName:'Fixture',inFlow}));
writeFileSync(${JSON.stringify(html.replace('.html','.report.json'))},JSON.stringify({printInterior:true}));`);
  process.env.BOOK_ENGINE='typst';let firstMeasurement;const reservations=[];
  const result=await fitWithBudget({args:[builder],html,pdf,passes:2,beforePass:async settings=>{
    if(reservations.length){firstMeasurement=JSON.parse(readFileSync(pdf.replace('.pdf','.pages.json')));}
    await(await publisherSession({directory:journal,env:{}})).reserveRender('1',settings);reservations.push(structuredClone(settings));
  }});
  assert.equal(result.pass,2,'A figure delayed beyond its following source paragraph needs fitting before paid review');
  const finding=readingOrderFindings(firstMeasurement).find(f=>f.figure_id==='first');
  assert.equal(finding?.defect,'delayed_source_figure');
  assert(reservations[1].inFlow.includes('first'));
  const measured=JSON.parse(readFileSync(pdf.replace('.pdf','.pages.json'))),figure=measured.figures.find(f=>f.id==='first');
  const paragraph=measured.paragraphs.find(p=>p.id===figure.source_next_paragraph);
  assert(figure.page<paragraph.start.page||(figure.page===paragraph.start.page&&figure.y+figure.h<=paragraph.start.y+1),'The image prints completely before its own following source paragraph');
  assert.equal(readingOrderFindings(measured).length,0);assert.equal(measured.figures.length,2);
  const text=execFileSync('pdftotext',['-layout',pdf,'-'],{encoding:'utf8'});
  for(const marker of ['FirstToolMarker','FirstBodyMarker','LaterToolMarker','LaterBodyMarker','EndMarker'])assert(text.includes(marker));
  assert.equal((await publisherSession({directory:journal,env:{}})).renderUsage('1').passes,2);
  console.log('PASS real displaced screenshot restored before its source paragraph in two reserved renders; both images and all source markers retained');
}finally{
  if(oldEngine==null)delete process.env.BOOK_ENGINE;else process.env.BOOK_ENGINE=oldEngine;
  if(process.argv.includes('--keep'))console.log(dir);else rmSync(dir,{recursive:true,force:true});
}
