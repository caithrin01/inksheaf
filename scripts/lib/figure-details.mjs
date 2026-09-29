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
  const folder=join(directory,figure.image_sha256+`-${columns}x${rows}`);mkdirSync(folder,{recursive:true});
  const script=`from PIL import Image
import json,sys,os
im=Image.open(sys.argv[1]).convert('RGB');cols,rows=int(sys.argv[2]),int(sys.argv[3]);w,h=im.size;out=[]
for row in range(rows):
 for col in range(0,cols,2):
  rect=[round(col*w/cols),round(row*h/rows),round(min(col+2,cols)*w/cols),round((row+1)*h/rows)]
  path=os.path.join(sys.argv[4],str(len(out)+1)+'.png');im.crop(rect).save(path)
  out.append({'source':path,'source_rect':rect,'source_width':w,'source_height':h,'row':row+1,'first_column':col+1,'last_column':min(col+2,cols)})
print(json.dumps(out))`;
  return JSON.parse(execFileSync('python3',['-c',script,figure.source,String(columns),String(rows),folder],{encoding:'utf8'})).map((p,i,a)=>({...p,index:i+1,total:a.length,image_sha256:createHash('sha256').update(readFileSync(p.source)).digest('hex')}));
}
