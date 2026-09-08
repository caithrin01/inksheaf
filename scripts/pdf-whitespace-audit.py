#!/usr/bin/env python3
"""Measure unoccupied vertical layout, not white pixels between printed glyphs.
Uses the actual 6x9 Typst body rectangle (0.78in top/bottom) and line/image boxes.
Normal interline leading (up to 5pt) is bridged. Every >30% page is recorded,
including front matter and closers; structural candidates are reasons to review,
not automatic exemptions. No page is suppressed by a --skip switch.
"""
import argparse,hashlib,json,subprocess
from pathlib import Path
import pymupdf as fitz
p=argparse.ArgumentParser();p.add_argument('pdf');p.add_argument('--out',required=True);p.add_argument('--typ');a=p.parse_args()
def query(tag):
    if not a.typ:return []
    run=subprocess.run(['typst','query','--root',str(Path.cwd()),'--font-path',str(Path.cwd()/'fonts'),a.typ,f'<{tag}>','--field','value'],capture_output=True,text=True)
    try:return json.loads(run.stdout)
    except:return []
starts=query('artstart');ends=query('artend');first=min([x['page'] for x in starts] or [1]);last=max([x['page'] for x in ends] or [999999]);rows=[]
doc=fitz.open(a.pdf)
for n,page in enumerate(doc,1):
    top,bottom=56.16,page.rect.height-56.16;left,right=44.64,page.rect.width-44.64;h=bottom-top;spans=[];texts=[];images=0
    for block in page.get_text('dict')['blocks']:
        if block['type']==1:
            r=fitz.Rect(block['bbox']);images+=1
            if r.x1>left and r.x0<right and r.y1>top and r.y0<bottom:spans.append((max(top,r.y0),min(bottom,r.y1)))
        else:
            for line in block.get('lines',[]):
                r=fitz.Rect(line['bbox']);text=''.join(s['text'] for s in line['spans'])
                if r.y1>top and r.y0<bottom and r.x1>left and r.x0<right and text.strip():
                    spans.append((max(top,r.y0),min(bottom,r.y1)));texts.append(text)
    spans.sort();merged=[]
    for y0,y1 in spans:
        if merged and y0<=merged[-1][1]+5:merged[-1][1]=max(merged[-1][1],y1)
        else:merged.append([y0,y1])
    head=(merged[0][0]-top)/h if merged else 1;tail=(bottom-merged[-1][1])/h if merged else 1
    internal=[(merged[i][0]-merged[i-1][1])/h for i in range(1,len(merged))]
    unused=max(0,1-sum(y1-y0 for y0,y1 in merged)/h)
    kind='body';candidate=None
    if n<first:kind='front matter';candidate='Intentional separate front-matter page; inspect its contents and sequence.'
    elif n>last:kind='back matter';candidate='Intentional separate back-matter page; inspect close and blank parity.'
    elif any(x['page']==n for x in starts) and any(x['page']==n for x in ends):kind='single-page article';candidate='Short standalone article; preserve verse or article boundary if the content warrants it.'
    elif any(x['page']==n for x in ends):kind='article ending';candidate='Next article starts on a fresh page; inspect for an avoidable sparse tail.'
    elif any(x['page']==n for x in starts):kind='article opening';candidate='Deliberate chapter heading space alone is not an exemption; inspect remaining gaps.'
    rows.append({'page':n,'unused':round(unused,3),'head':round(head,3),'tail':round(tail,3),'largest_internal_gap':round(max(internal or [0]),3),'images':images,'kind':kind,'over30':unused>.30,'candidate_reason':candidate,'review_status':'needs visual review' if unused>.30 else 'within threshold','text_start':' '.join(texts)[:240],'text_end':' '.join(texts)[-160:]})
result={'pdf':a.pdf,'sha256':hashlib.sha256(Path(a.pdf).read_bytes()).hexdigest(),'threshold':.30,'metric':'Unoccupied vertical intervals in usable page area; normal leading bridged up to 5pt. Not literal white-pixel percentage.','page_count':len(rows),'flagged_count':sum(r['over30'] for r in rows),'pages':rows}
Path(a.out).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k] for k in ['pdf','page_count','flagged_count']}))
