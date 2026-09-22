import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {join,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {streamReviewSheets} from './lib/review-raster.mjs';
import {rasterise,contactSheets,reviewPdf} from './lib/page-review.mjs';
const dir=mkdtempSync(join(tmpdir(),'review-stream-'));
try{
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.TimesRoman);
 for(let i=1;i<=20;i++){const p=doc.addPage([432,648]);p.drawText('Physical page '+i+' '+('Original body text. '.repeat(40)),{x:54,y:580,font,size:11,maxWidth:324,lineHeight:14});}
 const pdf=join(dir,'book.pdf');writeFileSync(pdf,await doc.save());
 const baseline=rasterise(pdf,join(dir,'baseline-pages'));
 for(const format of ['png','jpeg']){
  const sheets=contactSheets(baseline,join(dir,'baseline-'+format),{format}),events=[];
  const result=await streamReviewSheets(pdf,join(dir,format),{format,onSheet:s=>events.push(s)});
  assert.deepEqual(result,{pages:20,sheets:5});assert.equal(events.length,5);
  for(const file of baseline)assert(readFileSync(file).equals(readFileSync(join(dir,format,'pages',basename(file)))));
  for(const sheet of sheets)assert(readFileSync(sheet.file).equals(readFileSync(join(dir,format,'sheets',basename(sheet.file)))));
  assert.deepEqual(events.flatMap(s=>s.pages).sort((a,b)=>a-b),Array.from({length:20},(_,i)=>i+1));
 }
 console.log('PASS every raster and labelled sheet byte-identical in JPEG and PNG; all physical pages covered exactly once');
 const shim=join(dir,'bin');mkdirSync(shim);const realPoppler=execFileSync('which',['pdftoppm'],{encoding:'utf8'}).trim();
 writeFileSync(join(shim,'pdftoppm'),`#!/usr/bin/env python3
import sys,os,time,subprocess
args=sys.argv[1:];first=int(args[args.index('-f')+1]);control=os.environ['INKSHEAF_STREAM_CONTROL'];mode=os.environ['INKSHEAF_STREAM_MODE']
if first>1 and '-scale-to' in args and args[args.index('-scale-to')+1]=='900':
 deadline=time.monotonic()+8
 while not os.path.exists(control) and time.monotonic()<deadline:time.sleep(.01)
 if not os.path.exists(control):sys.exit(24)
 if mode=='failure' and first==6:
  open(control+'.done-'+str(first),'w').close();sys.exit(23)
code=subprocess.run([${JSON.stringify(realPoppler)}]+args).returncode
open(control+'.done-'+str(first),'w').close()
sys.exit(code)
`,{mode:0o755});
 const controlled=(control,mode)=>(cmd,args,options)=>spawn(cmd,args,{...options,env:{...process.env,PATH:shim+':'+process.env.PATH,INKSHEAF_STREAM_CONTROL:control,INKSHEAF_STREAM_MODE:mode}});
 const control=join(dir,'release'),live=join(dir,'early');let early=false;
 await streamReviewSheets(pdf,live,{spawnImpl:controlled(control,'success'),onSheet:sheet=>{
  if(sheet.pages[0]===1){early=!existsSync(join(live,'pages','p-20.png'));writeFileSync(control,'ready');}
 }});
 assert(early);console.log('PASS first sheet delivered while a later real Poppler range is deliberately unfinished');
 const short=await PDFDocument.create();short.addPage([432,648]);const shortPdf=join(dir,'short.pdf');writeFileSync(shortPdf,await short.save());
 await streamReviewSheets(shortPdf,live);
 assert.deepEqual(readdirSync(join(live,'pages')),['p-1.png']);assert.deepEqual(readdirSync(join(live,'sheets')),['sheet-001.jpg']);
 console.log('PASS a shorter repaired PDF removes obsolete page rasters and sheets');
 const failureControl=join(dir,'failure-release');let failObserved,finish,settled=false,confirmationStarted=false;
 const errorSeen=new Promise(resolve=>{failObserved=resolve;}),finished=new Promise(resolve=>{finish=resolve;});
 const deadline=setTimeout(()=>{writeFileSync(failureControl,'deadline');failObserved();finish();},8000);
 const run=reviewPdf(pdf,{outDir:join(dir,'failure'),key:'stub',stopOnError:true,concurrency:2,
  prepareSheets:(file,out,options)=>streamReviewSheets(file,out,{...options,spawnImpl:controlled(failureControl,'failure'),onError:error=>{options.onError(error);failObserved();}}),
  ask:async({check,text})=>{
   if(!check)return{text:text.includes('top-left is page 1,')?'[{"page":3,"check":4,"confidence":1,"note":"Clipped prose"}]':'[]'};
   confirmationStarted=true;writeFileSync(failureControl,'confirmation started');await finished;
   return{text:'{"confirmed":true,"origin":"rendered_layout","note":"Clipped prose remains held."}'};
  }}).then(result=>{settled=true;return result;});
 await errorSeen;assert(confirmationStarted);assert(!settled);finish();const result=await run;clearTimeout(deadline);
 assert.equal(result.errors.length,1);assert.match(result.errors[0],/Raster process failed/);assert.equal(result.pass2.calls,1);assert.equal(result.findings.length,1);
 for(const first of [1,6,11,16])assert(existsSync(failureControl+'.done-'+first));
 console.log('PASS raster failure stops later review work, drains started model confirmation and every Poppler child, and leaves review incomplete');
}finally{rmSync(dir,{recursive:true,force:true});}
