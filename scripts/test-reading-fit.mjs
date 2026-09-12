// A spacing-only renderer hold must reach publisher review with reading figures
// intact. A real compile error must still hold before any review can run.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fitWithBudget} from './lib/fit.mjs';
import {publisherSession} from './lib/publisher-session.mjs';
import {layoutInput} from './lib/publisher-layout.mjs';
const dir=mkdtempSync(resolve('proofs/reading-fit-')),previous=process.env.BOOK_ENGINE;
try{
 execFileSync('python3',['-c',"from PIL import Image;import sys;Image.new('RGB',(1200,1800),'gray').save(sys.argv[1])",join(dir,'source.png')]);
 const html=join(dir,'book.html'),pdf=join(dir,'book.pdf'),builder=join(dir,'builder.mjs'),journal=join(dir,'journal');
 const typ=`#set page(width: 6in, height: 9in, margin: (inside: 0.85in, outside: 0.62in, top: 0.78in, bottom: 0.78in))
#set text(font: "Source Serif 4", size: 10.5pt)
#context [#metadata((n:1,page:here().page())) <artstart>]
OpeningMarker.
#pagebreak()
BeforeFigureMarker.
#v(1.5in)
#figure([#context [#metadata((id:"source",role:"unknown",reading_mode:"column",page:here().page(),y:here().position().y.pt(),w:300,h:450)) <fig>]#image("source.png",width:300pt)])
AfterFigureMarker.
#context [#metadata((n:1,page:here().page())) <artend>]
`;
 writeFileSync(builder,`import {writeFileSync} from 'node:fs';if(process.argv.includes('--fit-figs'))throw Error('Unknown reading image must not shrink');writeFileSync(${JSON.stringify(html)},'fixture');writeFileSync(${JSON.stringify(html.replace('.html','.typ'))},${JSON.stringify(typ)});writeFileSync(${JSON.stringify(html.replace('.html','.report.json'))},JSON.stringify({printInterior:true}));`);
 process.env.BOOK_ENGINE='typst';
 const session=()=>publisherSession({directory:journal,env:{}});
 const result=await fitWithBudget({args:[builder],html,pdf,passes:1,allowMeasuredSpaceReview:true,beforePass:async settings=>await(await session()).reserveRender('1',settings)});
 assert.equal(result.spacing_requires_review,true);assert.deepEqual(result.fitFigs,{});
 const measured=JSON.parse(readFileSync(pdf.replace('.pdf','.pages.json')));
 assert(measured.bad.length>0&&measured.pages.every(p=>p.layout_geometry));
 const packet=layoutInput({measurement:measured,report:{},fit:result,review:{findings:[]}});
 for(const bad of measured.bad)assert(packet.pages.some(p=>p.page===bad.page),'Every unresolved gap must reach mandatory review');
 assert.equal(measured.figures[0].w,300);assert(!packet.candidates.some(c=>c.operation==='fit_figure'));
 const text=execFileSync('pdftotext',['-layout',pdf,'-'],{encoding:'utf8'});for(const marker of ['OpeningMarker','BeforeFigureMarker','AfterFigureMarker'])assert(text.includes(marker));
 assert.equal((await session()).renderUsage('1').passes,1);
 // Keep the preceding measurement present to prove stale spacing data cannot
 // turn a different renderer failure into successful review admission.
 writeFileSync(builder,`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(html.replace('.html','.typ'))},'#this-function-does-not-exist()');`);
 await assert.rejects(fitWithBudget({args:[builder],html,pdf,passes:1,allowMeasuredSpaceReview:true,beforePass:async settings=>await(await session()).reserveRender('1',settings)}));
 console.log('PASS spacing-only failure retains image scale and all source markers for review; actual compile failure remains held');
}finally{
 if(previous==null)delete process.env.BOOK_ENGINE;else process.env.BOOK_ENGINE=previous;
 rmSync(dir,{recursive:true,force:true});
}
