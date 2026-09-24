// A raster cannot tell a reviewer which lettering came from PDF text objects
// and which was already inside a source screenshot. Report both from the PDF.
import {execFileSync} from 'node:child_process';
export function artifactEvidence(pdf,page,sources){
  if(!Number.isSafeInteger(page)||page<1)throw new RangeError('Invalid physical PDF page');
  return JSON.parse(execFileSync('python3',['-c',`
import hashlib,json,sys
from pathlib import Path
import pymupdf as fitz
doc=fitz.open(sys.argv[1]);number=int(sys.argv[2]);page=doc[number-1]
if abs(page.rect.width-432)>.1 or abs(page.rect.height-648)>.1:
    print(json.dumps({'physical_page':number,'available':False,'reason':'Unknown body geometry outside the 6 by 9 inch renderer.'}));sys.exit(0)
bounds=[0,50,432,596]
body=page.get_text(clip=fitz.Rect(bounds),flags=fitz.TEXTFLAGS_TEXT|fitz.TEXT_INHIBIT_SPACES).strip()
embedded={}
for image in page.get_images(full=True):
    xref=image[0]
    if xref in embedded:continue
    extracted=doc.extract_image(xref)
    if extracted:embedded[xref]=(hashlib.sha256(extracted['image']).hexdigest(),[list(r) for r in page.get_image_rects(xref)])
sources=[]
for source in json.load(sys.stdin):
    digest=hashlib.sha256(Path(source['source']).read_bytes()).hexdigest();boxes=[]
    for actual,rects in embedded.values():
        if actual==digest:boxes.extend(rects)
    sources.append({'figure_id':source['id'],'source_sha256':digest,'embedded_bytes_match':bool(boxes),'printed_boxes_points':boxes})
print(json.dumps({'physical_page':number,'body_bounds_points':bounds,'typeset_body_characters':len(body),'typeset_body_text':body[:2000],'text_truncated':len(body)>2000,'source_bitmaps':sources,'scope':'Actual PDF text objects exclude lettering inside bitmap images. Exact embedded-byte matches locate unchanged source image content; these facts do not clear spacing, clipping or reading-size defects.'}))
`,pdf,String(page)],{input:JSON.stringify(sources.map(({id,source})=>({id,source}))),encoding:'utf8',maxBuffer:1_000_000,timeout:30000}));
}
