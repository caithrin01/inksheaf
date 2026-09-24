import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {PreparedTypesetting} from './lib/prepared-typesetting.mjs';
const dir=mkdtempSync(resolve('proofs/prepared-typesetting-'));
const env={...process.env,BOOK_ENGINE:'typst',OPENROUTER_API_KEY:''};
try{
 const html=join(dir,'book.html'),pdf=join(dir,'book.pdf');
 const fixture=join(dir,'sources.json');
 const posts=JSON.parse(readFileSync('proofs/recipes-fixture.json'));
 for(const p of posts){p.canonical_url='https://fixture.invalid/p/'+p.slug;p.body_html+='<p>Keep this source reference: <a href="https://example.com/recipe">the original recipe</a>.</p>';}
 writeFileSync(fixture,JSON.stringify(posts));
 const args=['scripts/build-book.mjs','fixture.invalid','--fixture',fixture,'--out',html,'--print-interior','--direct-links','--engine','typst'];
 const run=flags=>execFileSync(process.execPath,[...args,...flags],{env,stdio:'pipe'});
 run([]);const prepared=new PreparedTypesetting();prepared.capture({args,html});
 const sourceReport=JSON.parse(readFileSync(html.replace('.html','.report.json')));
 const flags=['--fit-text','1=0.54','--back-links','1'];
 // A fresh full builder is the independent oracle for the exact emitted book.
 run(flags);const freshTyp=readFileSync(html.replace('.html','.typ'),'utf8');
 const freshReport=JSON.parse(readFileSync(html.replace('.html','.report.json')));
 assert(prepared.render({args:[...args,...flags],html}));
 assert.equal(readFileSync(html.replace('.html','.typ'),'utf8'),freshTyp,'prepared adjustment matches a fresh full build exactly');
 const legacy=new PreparedTypesetting();legacy.capture({args:[...args,...flags],html});
 assert(legacy.render({args:[...args,...flags],html}));
 assert.equal(readFileSync(html.replace('.html','.typ'),'utf8'),freshTyp,'base adjustment flags survive reuse too');
 const reused=JSON.parse(readFileSync(html.replace('.html','.report.json')));
 for(const field of ['postOrder','bodyHashes','included','dateRange','backLinkArticles','fitText'])assert.deepEqual(reused[field],freshReport[field]);
 assert.deepEqual(reused.bodyHashes,sourceReport.bodyHashes);
 execFileSync('typst',['compile','--root',process.cwd(),'--font-path','fonts','--ignore-system-fonts',html.replace('.html','.typ'),pdf],{stdio:'pipe'});
 assert(execFileSync('pdftotext',[pdf,'-'],{encoding:'utf8'}).length>200);
 writeFileSync(fixture,readFileSync(fixture,'utf8')+' ');
 assert.throws(()=>prepared.render({args,html}),/inputs changed/);
 assert.equal(new PreparedTypesetting().render({args,html}),false,'new volume cannot reuse an earlier source bundle');
 // Integrity is checked against actual asset bytes, including ordinary photos.
 const source=join(dir,'photo.png');execFileSync('python3',['-c',"from PIL import Image;import sys;Image.new('RGB',(32,32),'red').save(sys.argv[1])",source]);
 const imageHtml=readFileSync(html,'utf8').replace('</body>','<img src="photo.png"></body>');writeFileSync(html,imageHtml);
 const images=new PreparedTypesetting();images.capture({args,html});writeFileSync(source,Buffer.from('changed'));
 assert.throws(()=>images.render({args,html}),/source image changed/);
 console.log('PASS prepared rebuild equals fresh output; source words/order retained, actual PDF compiled, changed inputs/images refused, fresh volume isolated');
}finally{rmSync(dir,{recursive:true,force:true});}
