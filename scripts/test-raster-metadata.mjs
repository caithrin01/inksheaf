// Actual Typst/Poppler output equivalence, including non-divisible page ranges.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {METADATA_LABELS,queryMetadata} from './typst-metadata.mjs';
const dir=mkdtempSync(resolve('proofs/metadata-raster-'));
try{
  const typ=join(dir,'book.typ'),pdf=join(dir,'book.pdf');
  writeFileSync(typ,'#set page(width: 6in, height: 9in)\n'+METADATA_LABELS.map((name,i)=>`#context [#metadata((page:here().page(), n:${i+1})) <${name}>]\nPage ${i+1}. Original words, punctuation and shapes.\n#rect(width:50pt,height:30pt,fill:rgb("335577"))\n${i<METADATA_LABELS.length-1?'#pagebreak()':''}`).join('\n'));
  execFileSync('typst',['compile','--root',process.cwd(),'--font-path','fonts','--ignore-system-fonts',typ,pdf],{stdio:'pipe'});
  const metadata=queryMetadata(typ);
  for(const name of METADATA_LABELS){
    const expected=JSON.parse(execFileSync('typst',['query','--root',process.cwd(),'--font-path','fonts','--ignore-system-fonts',typ,`<${name}>`,'--field','value'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
    assert.equal(expected.length,1);assert.deepEqual(metadata[name],expected);
  }
  console.log('PASS one metadata query equals every original label query');
  for(const gray of [false,true]){
    const serial=join(dir,gray?'serial-gray':'serial'),parallel=join(dir,gray?'parallel-gray':'parallel');mkdirSync(serial);mkdirSync(parallel);
    execFileSync('pdftoppm',['-png',...(gray?['-gray','-r','30']:['-scale-to','900']),pdf,join(serial,'p')],{stdio:'pipe'});
    execFileSync('python3',['scripts/raster-pages.py',pdf,join(parallel,'p'),...(gray?['--gray','--dpi','30']:['--scale','900']),'--workers','4'],{stdio:'pipe'});
    const pages=readdirSync(serial).sort();assert.equal(pages.length,METADATA_LABELS.length);assert.deepEqual(readdirSync(parallel).sort(),pages);
    for(const page of pages)assert.deepEqual(readFileSync(join(parallel,page)),readFileSync(join(serial,page)));
    console.log(`PASS all ${pages.length} ${gray?'measurement':'review'} rasters are byte-identical across four workers`);
  }
}finally{rmSync(dir,{recursive:true,force:true});}
