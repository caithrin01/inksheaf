#!/usr/bin/env python3
"""Check rendered glyphs/images against physical paper, independent of HTML layout."""
import argparse,hashlib,json
from pathlib import Path
import fitz
p=argparse.ArgumentParser();p.add_argument('pdf');p.add_argument('--out',required=True);a=p.parse_args()
doc=fitz.open(a.pdf);bad=[];glyphs=0;images=0;missing=[]
for number,page in enumerate(doc,1):
    paper=page.rect+(-.5,-.5,.5,.5)
    for block in page.get_text('rawdict')['blocks']:
        if block['type']==1:
            images+=1
            if not paper.contains(fitz.Rect(block['bbox'])):bad.append({'page':number,'kind':'image','bbox':block['bbox']})
        else:
            for line in block['lines']:
                for span in line['spans']:
                    for char in span['chars']:
                        if not char['c'].strip():continue
                        glyphs+=1
                        if not paper.contains(fitz.Rect(char['bbox'])):bad.append({'page':number,'kind':'glyph','char':char['c'],'bbox':char['bbox']})
    if 'An image in a format print cannot use was left out.' in page.get_text() or 'An image could not be retrieved for this proof.' in page.get_text():missing.append(number)
result={'pdf':a.pdf,'sha256':hashlib.sha256(Path(a.pdf).read_bytes()).hexdigest(),'pages':len(doc),'glyphs':glyphs,'images':images,'outside_paper':bad,'missing_image_pages':missing,'pass':not bad and not missing}
Path(a.out).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k] for k in ['pdf','pages','glyphs','images','pass']}))
raise SystemExit(0 if result['pass'] else 1)
