// Enlarge regular thumbnail montages without replacing the complete original.
// Every detail is a lossless crop of decoded source pixels; their non-overlapping
// rectangles cover the entire source once, in row order. No invented labels.
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export function prepareFigureDetails(figure,grid,directory){
  const {columns,rows}=grid;
  if(!Number.isInteger(columns)||columns<4||columns>6||!Number.isInteger(rows)||rows<1||rows>4)throw Error('Invalid source detail grid');
  const bytes=readFileSync(figure.source);
  if(createHash('sha256').update(bytes).digest('hex')!==figure.image_sha256)throw Error('Source figure evidence changed');
  const folder=join(directory,figure.image_sha256+`-${columns}x${rows}-snap`);mkdirSync(folder,{recursive:true});
  // Cuts move to the nearest blank band within 8% of the even grid line, and neighbouring
  // tiles overlap by 2%, so no line of text is sliced in half at a cut (Calling the Shots,
  // 2026-10-09: a leaderboard cut through "GLM 5 Tu" and a half-drawn "9.").
  const script=`from PIL import Image
import json,sys,os
im=Image.open(sys.argv[1]).convert('RGB');cols,rows=int(sys.argv[2]),int(sys.argv[3]);w,h=im.size;out=[]
g=im.convert('L');px=g.load()
bg=max(range(256),key=lambda v:g.histogram()[v])
def ink_row(y,x0,x1):
 step=max(1,(x1-x0)//400);return sum(1 for x in range(x0,x1,step) if abs(px[x,y]-bg)>40)
def ink_col(x,y0,y1):
 step=max(1,(y1-y0)//400);return sum(1 for y in range(y0,y1,step) if abs(px[x,y]-bg)>40)
def snap(pos,limit,ink,lo,hi):
 win=max(2,round(limit*0.08));best=pos;score=None
 for p in range(max(1,pos-win),min(limit-1,pos+win)+1):
  v=ink(p,lo,hi)
  if score is None or v<score or (v==score and abs(p-pos)<abs(best-pos)):best,score=p,v
 return best
ys=[0]+[snap(round(r*h/rows),h,ink_row,0,w) for r in range(1,rows)]+[h]
xs=[0]+[snap(round(c*w/cols),w,ink_col,0,h) for c in range(1,cols)]+[w]
ov_x,ov_y=round(w*0.02),round(h*0.02)
for row in range(rows):
 for col in range(0,cols,2):
  rect=[max(0,xs[col]-ov_x),max(0,ys[row]-ov_y),min(w,xs[min(col+2,cols)]+ov_x),min(h,ys[row+1]+ov_y)]
  path=os.path.join(sys.argv[4],str(len(out)+1)+'.png');im.crop(rect).save(path)
  out.append({'source':path,'source_rect':rect,'source_width':w,'source_height':h,'row':row+1,'first_column':col+1,'last_column':min(col+2,cols)})
print(json.dumps(out))`;
  return JSON.parse(execFileSync('python3',['-c',script,figure.source,String(columns),String(rows),folder],{encoding:'utf8'})).map((p,i,a)=>({...p,index:i+1,total:a.length,image_sha256:createHash('sha256').update(readFileSync(p.source)).digest('hex')}));
}
