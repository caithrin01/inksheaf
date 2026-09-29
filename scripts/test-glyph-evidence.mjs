import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync,copyFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {glyphEvidence} from './lib/glyph-evidence.mjs';
import {reviewPdf} from './lib/page-review.mjs';
const dir=mkdtempSync(join(tmpdir(),'glyph-evidence-'));
try{
 const source=join(dir,'book.typ'),pdf=join(dir,'book.pdf');
 writeFileSync(source,'#set page(width: 6in, height: 9in)\n#set text(font: ("Source Serif 4", "Noto Emoji"), size: 10.5pt)\nBirthday 🎂 after the prose.');
 execFileSync('typst',['compile','--ignore-system-fonts','--font-path',resolve('fonts'),source,pdf]);
 const glyph=glyphEvidence(pdf,1,join(dir,'actual'));
 assert(existsSync(glyph.file));assert.equal(glyph.characters.length,1);assert.equal(glyph.characters[0].codepoint,'U+1F382');assert(glyph.characters[0].glyph_id>0);assert.equal(glyph.characters[0].size_points,10.5);
 for(const confirmed of [false,true]){
  let inspected=false;
  const review=await reviewPdf(pdf,{outDir:join(dir,String(confirmed)),imageFormat:'png',ask:async({check,images,text})=>{
   if(check!==6)return{text:JSON.stringify([{page:1,check:6,confidence:.9,note:'The small symbol needs inspection.'}])};
   inspected=true;assert.equal(images.length,2);assert(images[1].endsWith('/glyphs/1/glyphs.png'));assert(text.includes('U+1F382'));assert(text.includes('nonzero glyph ID or Unicode value alone does not prove'));
   return{text:JSON.stringify({confirmed,origin:'rendered_layout',note:confirmed?'The symbol remains unreadable.':'A legible monochrome birthday cake is present.'})};
  }});
  assert(inspected);assert.equal(review.errors.length,0);assert.equal(review.findings.length,confirmed?1:0);assert.equal((confirmed?review.findings:review.dismissed)[0].glyph_evidence.characters[0].codepoint,'U+1F382');
 }
 const latin=join(dir,'latin');mkdirSync(latin);copyFileSync('fonts/SourceSerif4[opsz,wght].ttf',join(latin,'serif.ttf'));
 writeFileSync(source,'#set text(font: "Source Serif 4")\nMissing 国产.');
 execFileSync('typst',['compile','--ignore-system-fonts','--font-path',latin,source,pdf],{stdio:'pipe'});
 const missing=glyphEvidence(pdf,1,join(dir,'missing'));
 assert(missing.characters.some(c=>c.glyph_id===0||c.codepoint==='U+FFFD'));
 console.log('PASS actual emoji crop and font records, unresolved-symbol holds, and actual missing-glyph evidence');
}finally{rmSync(dir,{recursive:true,force:true});}
