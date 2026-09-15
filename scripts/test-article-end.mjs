// A measurement marker must not consume the space after a closing figure and
// create an otherwise empty article leaf. Exercise the actual Typst emitter.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {emitTypst} from './lib/typst-emit.mjs';

const dir=mkdtempSync(resolve('proofs/article-end-'));
try {
  execFileSync('python3',['-c',`from PIL import Image
import sys
Image.new('RGB',(800,1000),(150,100,70)).save(sys.argv[1])`,join(dir,'photo.png')]);
  const article=(title,body)=>`<section class="article"><div class="arthead"><h2 class="arttitle">${title}</h2></div><div class="artbody">${body}</div></section>`;
  const wrap=body=>`<html><body><section class="titlepage"><div class="t">Boundary fixture</div></section>${article('First essay',body)}${article('Following essay','<p>FollowingMarker. This separate piece begins on the next leaf.</p>')}</body></html>`;
  const body='<p>BeforeMarker. '+ 'These original words must stay before the photograph. '.repeat(12)+'</p><figure><img src="photo.png" alt="photograph" data-fig="closing-photo"/></figure>';
  const compile=(name,html,opts={})=>{
    const typ=join(dir,name+'.typ'),pdf=join(dir,name+'.pdf');
    writeFileSync(typ,emitTypst(html,{baseDir:dir,...opts}));
    execFileSync('typst',['compile','--font-path','fonts','--ignore-system-fonts',typ,pdf]);
    const query=selector=>JSON.parse(execFileSync('typst',['query','--font-path','fonts','--ignore-system-fonts',typ,selector,'--field','value'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
    return {pdf,figures:query('<fig>'),starts:query('<artstart>'),ends:query('<artend>')};
  };
  const probe=compile('probe',wrap(body),{fitFigs:{'closing-photo':1}}),first=probe.figures[0];
  // Leave less than the figure's normal 1em below-space. Content fits; adding a
  // zero-height block afterwards used to force that space onto an extra page.
  const imageTop=Number(execFileSync('python3',['-c',`import pymupdf as f,sys
d=f.open(sys.argv[1]);print(d[int(sys.argv[2])-1].get_image_info()[0]['bbox'][1])`,probe.pdf,String(first.page)],{encoding:'utf8'}));
  const height=Math.floor((591.84-imageTop-5)/72*100)/100;
  assert(height>1&&height<5.5,'The fixture must exercise a bounded closing photograph');
  const fitted=compile('fitted',wrap(body),{fitFigs:{'closing-photo':height}}),figure=fitted.figures[0];
  assert.equal(figure.page,first.page,'The photograph still fits beside its source prose');
  assert.equal(fitted.ends[0].page,figure.page,'The article-end marker must stay with the photograph, without an empty closing leaf');
  assert.equal(fitted.starts[1].page,figure.page+1,'The following essay starts on the immediately following leaf');
  execFileSync('python3',['-c',`import pymupdf as f,sys
from PIL import Image
d=f.open(sys.argv[1]); p=d[int(sys.argv[2])-1]; image=Image.open(sys.argv[3]).convert('RGB')
assert 'BeforeMarker.' in p.get_text()
blocks=[b for b in p.get_text('dict')['blocks'] if b['type']==0 and 'BeforeMarker.' in ''.join(s['text'] for l in b['lines'] for s in l['spans'])]
seen=[]
for info in p.get_image_info(xrefs=True):
 pix=f.Pixmap(d,info['xref'])
 if (pix.width,pix.height)==image.size:
  assert pix.samples==image.tobytes();seen.append(info)
assert len(seen)==1
assert blocks[0]['bbox'][3]<seen[0]['bbox'][1]
text=''.join(page.get_text() for page in d)
assert text.count('BeforeMarker.')==1 and text.count('FollowingMarker.')==1
assert 'metadata' not in text and 'here()' not in text
`,fitted.pdf,String(figure.page),join(dir,'photo.png')]);
  console.log('PASS near-full closing photograph has no metadata-only leaf; source prose, pixels and order survive');

  for(const [name,tail] of [
    ['prose','<p>TailMarker. A real final paragraph remains part of this essay.</p>'],
    ['caption','<figure><img src="photo.png" alt="photograph" data-fig="caption-photo"/><figcaption>TailMarker. The final caption belongs to the photograph.</figcaption></figure>'],
    ['verse','<pre class="preformatted-text">TailMarker. A first line\nA second line\nA final line</pre>'],
  ]){
    const control=compile(name,wrap('<p>OpeningMarker.</p>'+tail));
    const tailPage=Number(execFileSync('python3',['-c',`import pymupdf as f,sys
d=f.open(sys.argv[1]); pages=[i+1 for i,p in enumerate(d) if 'TailMarker.' in p.get_text()]
assert len(pages)==1;print(pages[0])`,control.pdf],{encoding:'utf8'}));
    assert.equal(control.ends[0].page,tailPage,`${name}: metadata describes the real final content`);
    assert.equal(control.starts[1].page,tailPage+1,`${name}: no unwanted leaf between essays`);
    console.log(`PASS ${name} ending retains its actual article boundary`);
  }
} finally { rmSync(dir,{recursive:true,force:true}); }
