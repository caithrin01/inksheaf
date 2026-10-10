import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {emitTypst} from './lib/typst-emit.mjs';
const dir=resolve('output/print-recovery-test');mkdirSync(dir,{recursive:true});
const rows=[['a','The Anthropic IPO Is Coming. We','counterfactual.substack.com'],['b','If you work in the Animal movement, you need to move to...','frontieranimals.substack.com'],['c','A long source domain','a'.repeat(60)+'.example.com']];
const html='<html><body><section class="article"><div class="arthead"><h2 class="arttitle">Link layout regression</h2></div><div class="artbody"><div class="linknote"><ul>'+rows.map(([label,title,url])=>`<li><span class="lk">${label}</span><span class="lk-text">${title}</span><span class="lk-url">${url}</span></li>`).join('')+'</ul></div></div></section></body></html>';
writeFileSync(join(dir,'links.typ'),emitTypst(html,{baseDir:dir}));
execFileSync('typst',['compile','--font-path','fonts','--ignore-system-fonts',join(dir,'links.typ'),join(dir,'links.pdf')],{stdio:'pipe'});
execFileSync('python3',['-c',`import pymupdf,sys
d=pymupdf.open(sys.argv[1]);text=''.join(p.get_text() for p in d)
assert 'The Anthropic IPO Is Coming. We' in text
for page in d:
 spans=[s for b in page.get_text('dict')['blocks'] if 'lines' in b for l in b['lines'] for s in l['spans'] if s['text'].strip()]
 for i,a in enumerate(spans):
  for b in spans[i+1:]:
   if abs(a['origin'][1]-b['origin'][1])<2:
    overlap=min(a['bbox'][2],b['bbox'][2])-max(a['bbox'][0],b['bbox'][0])
    assert overlap<0.3,(a['text'],b['text'],overlap)
next(p for p in d if 'The Anthropic IPO' in p.get_text()).get_pixmap(matrix=pymupdf.Matrix(1.5,1.5)).save(sys.argv[2])`,join(dir,'links.pdf'),join(dir,'links.png')]);
console.log('PASS compiled long link titles and domains do not overlap');
