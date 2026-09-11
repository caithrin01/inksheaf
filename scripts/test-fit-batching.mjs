// Both defects arise from real source pagination. A two-pass allowance must
// collect one article's stranded references and fit another article's ending,
// while retaining every source word/reference and reserving before the builder.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fitWithBudget} from './lib/fit.mjs';
import {publisherSession} from './lib/publisher-session.mjs';
mkdirSync('proofs',{recursive:true});
const dir=mkdtempSync(resolve('proofs/fit-batching-')),oldEngine=process.env.BOOK_ENGINE;
try{
  const paragraph='A measured paragraph keeps the original writing intact while the book finds its page breaks. ';
  const note='<section class="linknote"><h2 class="linknote-h">Links</h2><ul>'+Array.from({length:5},(_,i)=>`<li><span class="lk">${i+1}</span><span class="lk-text">A reference for the complete source paragraph ${i+1}</span><span class="lk-url">example.com/source-${i+1}</span></li>`).join('')+'</ul></section>';
  const article=n=>`<section class="article" id="art-${n}"><header class="arthead"><h2 class="arttitle">Article ${n+1}</h2></header><div class="artbody"><p>${paragraph.repeat(26)}EndMarker${n}.</p></div>${n===0?note:''}</section>`;
  const source='<html><body>'+article(0)+article(1)+'</body></html>';
  const html=join(dir,'book.html'),pdf=join(dir,'book.pdf'),builder=join(dir,'builder.mjs'),journal=join(dir,'journal');
  writeFileSync(builder,`import {readFileSync,writeFileSync} from 'node:fs';
import {emitTypst} from ${JSON.stringify(new URL('./lib/typst-emit.mjs',import.meta.url).href)};
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1],state=JSON.parse(readFileSync(${JSON.stringify(join(journal,'state.json'))}));
if(!state.renderBudget.volumes['1'].passes.length)throw Error('Builder started without reservation');
const backLinks=args.includes('--back-links')?value('--back-links').split(',').map(Number):[];
const fitText=args.includes('--fit-text')?Object.fromEntries(value('--fit-text').split(',').map(v=>v.split('=').map(Number))):{};
writeFileSync(${JSON.stringify(html)},${JSON.stringify(source)});
writeFileSync(${JSON.stringify(html.replace('.html','.typ'))},emitTypst(${JSON.stringify(source)},{baseDir:${JSON.stringify(dir)},pubName:'Fixture',backLinks,fitText}));
writeFileSync(${JSON.stringify(html.replace('.html','.report.json'))},JSON.stringify({printInterior:true}));`);
  const reservations=[];
  process.env.BOOK_ENGINE='typst';
  const result=await fitWithBudget({args:[builder],html,pdf,passes:2,beforePass:async settings=>{
    if(reservations.length===1){
      const before=JSON.parse(readFileSync(pdf.replace('.pdf','.pages.json')));
      assert(before.articles.every(a=>a.end>a.start&&before.pages[a.end-1].ink_rows<.25));
    }
    await(await publisherSession({directory:journal,env:{}})).reserveRender('1',settings);
    reservations.push(structuredClone(settings));
  }});
  assert.equal(result.pass,2);assert.equal(reservations.length,2);
  assert.deepEqual(reservations[1].backLinks,[1],'references must reach the second render alongside leading');
  assert.equal(reservations[1].fitText[1],undefined,'move the references before tightening that same article');
  assert.equal(reservations[1].fitText[2],.62,'independent sparse text ending shares the render');
  assert.equal((await publisherSession({directory:journal,env:{}})).renderUsage('1').passes,2);
  const text=execFileSync('pdftotext',['-layout',pdf,'-'],{encoding:'utf8'})
    .split('\n').filter(line=>!/^\s*(Fixture|Article [12]|\d+)\s*$/i.test(line)).join('\n')
    .replace(/\u00ad/g,'').replace(/-\s*\n\s*(?=[a-z])/g,'').replace(/\s+/g,'');
  assert.equal(text.split(paragraph.replace(/\s+/g,'')).length-1,52);
  assert(text.includes('EndMarker0.')&&text.includes('EndMarker1.'));
  for(let i=1;i<=5;i++)assert.equal(text.split(`example.com/source-${i}`).length-1,1);
  assert.match(text,/LINKSONPAGE\d+/);
  const measurement=JSON.parse(readFileSync(pdf.replace('.pdf','.pages.json')));
  assert.equal(measurement.linkStarts.length,0);
  assert(measurement.pages.every(p=>p.layout_geometry?.blocks));
  console.log('PASS real two-pass fitting batches reference and leading repairs; all 52 source sentences, five references and durable reservations survive');
}finally{
  if(oldEngine==null)delete process.env.BOOK_ENGINE;else process.env.BOOK_ENGINE=oldEngine;
  rmSync(dir,{recursive:true,force:true});
}
