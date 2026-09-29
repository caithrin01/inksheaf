// Actual PDF lines/image rectangles feed the same bounded packet used in the
// publisher. No model calls and no owner artifacts are needed for this fixture.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {layoutInput,layoutBatches,validateLayout} from './lib/publisher-layout.mjs';
const dir=mkdtempSync(join(tmpdir(),'publisher-context-'));
try{
  const pdf=join(dir,'book.pdf'),png=join(dir,'image.png'),out=join(dir,'spacing.json');
  execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(150,220),(120,130,140)).save(sys.argv[1])",png]);
  const book=await PDFDocument.create(),font=await book.embedFont(StandardFonts.TimesRoman),bitmap=await book.embedPng(readFileSync(png));
  const pages=Array.from({length:3},()=>book.addPage([432,648]));
  pages[0].drawText('PreviousIndependentPieceMarker',{x:55,y:300,size:10.5,font});
  pages[1].drawText('CompleteParagraphEndMarker',{x:55,y:260,size:10.5,font});
  pages[2].drawImage(bitmap,{x:55,y:371.84,width:150,height:220});
  pages[2].drawText('ActualCaptionMarker below the photograph.',{x:55,y:350,size:8.5,font});
  writeFileSync(pdf,await book.save());
  execFileSync('python3',['scripts/pdf-whitespace-audit.py',pdf,'--out',out],{stdio:'pipe'});
  const spacing=JSON.parse(readFileSync(out)),pageText=execFileSync('pdftotext',['-layout',pdf,'-'],{encoding:'utf8'}).split('\f');
  const measurement={pages:spacing.pages,articles:[{n:1,start:1,end:1},{n:2,start:2,end:3}],
    figures:[{id:'source-figure',source:'/private/source-image.png',page:3,y:56.16,h:220,w:150,floating:false,role:'picture'}],
    paragraphs:[{id:2,start:{page:2,y:380},end:{page:2,y:395}}]};
  const input=layoutInput({measurement,report:{},fit:{},review:{findings:[]},pageText,pdfHash:spacing.sha256});
  const context=input.pages.find(p=>p.page===2).adjacent_layout;
  assert.equal(context.previous_page.same_article,false);assert.equal(context.next_page.same_article,true);
  assert.match(context.current_page.printed_excerpt.text,/CompleteParagraphEndMarker/);
  assert.equal(context.current_page.paragraph_anchors[0].end.page,2);
  assert.deepEqual(context.current_page.body_bounds_points,[44.64,56.16,387.36,591.84]);
  assert(context.current_page.trailing_space_points>190&&context.current_page.trailing_space_points<210);
  assert(context.next_page.figures[0].height_points>context.current_page.trailing_space_points);
  const image=context.next_page.printed_blocks.find(b=>b.kind==='image');
  const caption=context.next_page.printed_blocks.find(b=>b.printed_text?.text.includes('ActualCaptionMarker'));
  assert(Math.abs(image.bbox[3]-image.bbox[1]-220)<.01);
  assert(caption.bbox[1]>image.bbox[3]);
  assert(!JSON.stringify(input).includes('/private/'));
  assert.equal(input.pages.find(p=>p.page===1).adjacent_layout.previous_page,null);
  assert.equal(input.pages.find(p=>p.page===3).adjacent_layout.next_page,null);
  const batch=layoutBatches(input,1).find(b=>b.pages[0].page===2);
  assert.equal(batch.pages.length,1);assert.deepEqual(batch.pages[0].adjacent_layout.next_page,context.next_page);
  // Context supplies evidence; it must never automatically dismiss a content defect.
  batch.pages[0].findings=[{page:2,check:3}];
  assert.throws(()=>validateLayout({decisions:[{page:2,decision:'intentional_space',candidate_id:null,reason:'The next image exceeds the gap.'}]},batch),/cannot be excused/);
  const legacy=layoutInput({measurement:{pages:[{page:1,blank:.5}]},report:{},fit:{},review:{findings:[]}});
  assert.equal(legacy.pages[0].adjacent_layout.current_page.trailing_space_points,null);
  const long=structuredClone(measurement);long.pages[2].layout_geometry.blocks=Array.from({length:50},()=>({kind:'text',bbox:[1,2,3,4],text:'x'.repeat(1000)}));
  const bounded=layoutInput({measurement:long,report:{},fit:{},review:{findings:[]},pageText:['','', 'x'.repeat(10000)]}).pages.find(p=>p.page===2).adjacent_layout.next_page;
  assert.equal(bounded.printed_blocks.length,8);assert(bounded.printed_blocks_truncated);
  assert(bounded.printed_blocks.every(b=>b.printed_text.text.length===400&&b.printed_text.truncated));
  assert.equal(bounded.printed_excerpt.text.length,2000);assert(bounded.printed_excerpt.truncated);
  console.log('PASS actual PDF gap, next image, caption, article boundary and paragraph evidence; bounded batch context; missing geometry and defect holds');
}finally{rmSync(dir,{recursive:true,force:true});}
