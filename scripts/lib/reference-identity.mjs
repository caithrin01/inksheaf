// Read encoded glyphs at compiled reference positions. Matching text establishes
// identity only; it never proves legibility, source preservation or page quality.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export function referenceIdentity(pdf,page,references){
  if(!Number.isSafeInteger(page)||page<1)throw new RangeError('Invalid physical PDF page');
  const markers=references.map(({label,x_points,y_points})=>({label,x:x_points,y:y_points}));
  const result=JSON.parse(execFileSync('python3',['-c',`
import json,math,sys,pymupdf as fitz
markers=json.load(sys.stdin);doc=fitz.open(sys.argv[1]);page=doc[int(sys.argv[2])-1]
spans=[s for s in page.get_texttrace() if s.get('type') in (0,1) and s.get('opacity',1)>0]
def finite(v):return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v)
records=[]
for marker in markers:
 label=marker.get('label');x,y=marker.get('x'),marker.get('y')
 record={'expected_label':label,'x_points':x,'y_points':y,'observed_label':None,'identity_matches':None,'status':'unknown'}
 if isinstance(label,str) and 1<=len(label)<=6 and label.isascii() and label.isalpha() and label.islower() and finite(x) and finite(y):
  starts=[]
  for span in spans:
   for i,(cp,gid,origin,bbox) in enumerate(span['chars']):
    if abs(origin[0]-x)<=.2 and abs(origin[1]-y)<=.2:starts.append((span,i))
  # Compiled superscript markers occupy their own draw run. Read the entire
  # run so shortened/extended labels cannot match merely by sharing a prefix.
  # Overlapping starts stay ambiguous, including partial or missing-glyph runs.
  if len(starts)==1:
   span,i=starts[0];chars=span['chars'];observed=''.join(chr(c[0]) for c in chars)
   valid=i==0 and 1<=len(observed)<=6 and observed.isascii() and observed.isalpha() and observed.islower()
   valid=valid and all(abs(c[2][1]-y)<=.2 and (c[1]>0 or (c[1]==-1 and c[3][2]==c[3][0])) for c in chars)
   valid=valid and all(0<=b[2][0]-a[2][0]<=2*span['size'] for a,b in zip(chars,chars[1:]))
   if valid:record.update(observed_label=observed,identity_matches=observed==label,status='measured',font=span['font'],glyph_ids=[c[1] for c in chars])
 records.append(record)
print(json.dumps(records))
`,pdf,String(page)],{input:JSON.stringify(markers),encoding:'utf8',timeout:10_000,maxBuffer:1_000_000,stdio:['pipe','pipe','pipe']}));
  return {pdf_sha256:createHash('sha256').update(readFileSync(pdf)).digest('hex'),physical_page:page,markers:result,
    scope:'Encoded glyph identity at the compiled marker start, within 0.2 PDF points. Absent, ambiguous or unsupported positions remain unknown. Matching labels do not establish visual legibility or waive other findings.'};
}
export function adjudicateReferenceIdentity(result,identity){
  const wrong=identity?.markers?.filter(m=>m.status==='measured'&&m.identity_matches===false&&typeof m.observed_label==='string')||[];
  if(!wrong.length)return result;
  return {...result,confirmed:true,origin:'measured_layout',defect:'reference_identity',model_confirmation:result,
    note:`Printed reference ${JSON.stringify(wrong[0].observed_label)} differs from its compiled label ${JSON.stringify(wrong[0].expected_label)}.`};
}
