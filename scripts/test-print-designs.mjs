#!/usr/bin/env node
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {chromium} from 'playwright';import {PDFDocument} from 'pdf-lib';
import {COVER_DESIGNS,designSelection} from '../functions/lib/book-design.js';
const dir='output/pdf/integrated';mkdirSync(dir,{recursive:true});
const identity=JSON.parse(readFileSync('scripts/fixtures/publication-caithrin.json'));
writeFileSync(`${dir}/brand.json`,JSON.stringify({host:'caithrin.com',logo_url:identity.logo_url,cover_bg:identity.theme.cover_bg,cover_print:identity.theme.cover_ink}));
writeFileSync(`${dir}/meta.json`,JSON.stringify({pubName:'caithrin',host:'caithrin.com',kindLine:'Annual · 2025–26',spineText:'caithrin · 2025–26',dates:'July 2025 – June 2026',countLine:'22 essays',desc:'A test cover using the local calendar-edition fixture. Not an approved print run.'}));
const browser=await chromium.launch();const rows=[];
try{for(const d of COVER_DESIGNS){
 writeFileSync(`${dir}/design.json`,JSON.stringify(designSelection(d.id,identity.theme)));
 const html=`${dir}/${d.id}.html`,pdf=`${dir}/${d.id}.pdf`;
 execFileSync('node',['scripts/cover-wrap.mjs','903','666',html,'--meta',`${dir}/meta.json`,'--brand',`${dir}/brand.json`,'--design-file',`${dir}/design.json`],{stdio:'pipe'});
 const p=await browser.newPage({viewport:{width:1204,height:888}});await p.goto('file://'+process.cwd()+'/'+html);await p.evaluate(()=>document.fonts.ready);
 const fits=await p.locator('.panel.front .edition-cover').evaluate(el=>{const box=el.getBoundingClientRect();return [...el.children].filter(x=>getComputedStyle(x).display!=='none').every(x=>{const r=x.getBoundingClientRect();return r.top>=box.top&&r.bottom<=box.bottom&&r.left>=box.left&&r.right<=box.right;});});
 if(!fits)throw Error(d.id+' cover overflow');
 if(!await p.locator('.cv-logo').evaluate(el=>el.complete&&el.naturalWidth>0))throw Error('Print logo not painted');
 await p.pdf({path:pdf,preferCSSPageSize:true,printBackground:true});const doc=await PDFDocument.load(readFileSync(pdf));if(doc.getPageCount()!==1)throw Error('Cover is not one wrap page');
 const {width,height}=doc.getPage(0).getSize();if(Math.abs(width-903)>1||Math.abs(height-666)>1)throw Error('Wrong print geometry');
 await p.locator('.panel.front').screenshot({path:`${dir}/${d.id}-front.png`});rows.push({design:d.id,width,height,pages:1,logo:true,fit:true});console.log('PASS print cover',d.id);await p.close();
}}finally{await browser.close();}
writeFileSync(`${dir}/results.json`,JSON.stringify(rows,null,2));
