// Compare actual PDF glyphs with the compiled renderer's intended heads/folios.
// Typography (small caps, italic essay heads) does not change those labels.
import {execFileSync} from 'node:child_process';
const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/gu,' ').trim();
export function auditRunningMatter(pdf, context) {
  const known=context.filter(p=>p.running_head_map_available&&p.folio_map_available
    && Object.hasOwn(p,'expected_running_head')&&Object.hasOwn(p,'expected_printed_folio'));
  if(!known.length)return [];
  const actual=JSON.parse(execFileSync('python3',['-c',`
import json,sys
import pymupdf as fitz
doc=fitz.open(sys.argv[1]);rows=[]
for n,p in enumerate(doc,1):
    if abs(p.rect.width-432)>.1 or abs(p.rect.height-648)>.1:continue
    head=[];foot=[]
    for block in p.get_text('dict',sort=True)['blocks']:
        for line in block.get('lines',[]):
            text=''.join(s['text'] for s in line['spans']).strip()
            if not text:continue
            y0,y1=line['bbox'][1],line['bbox'][3]
            if y0<50:head.append(text)
            if y1>596:foot.append(text)
    rows.append({'page':n,'head':' '.join(head),'folio':' '.join(foot)})
print(json.dumps(rows))
`,pdf],{encoding:'utf8',maxBuffer:2_000_000}));
  const pages=new Map(actual.map(p=>[p.page,p]));
  return known.filter(p=>pages.has(p.page)).map(p=>{
    const a=pages.get(p.page),headMatches=normalize(a.head)===normalize(p.expected_running_head),folioMatches=normalize(a.folio)===normalize(p.expected_printed_folio);
    return {page:p.page,verified:headMatches&&folioMatches,head_matches:headMatches,folio_matches:folioMatches,
      actual_head:a.head,actual_folio:a.folio,expected_head:p.expected_running_head,expected_folio:p.expected_printed_folio};
  });
}
