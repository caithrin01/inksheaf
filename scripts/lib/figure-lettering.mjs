// Measure the lettering actually present in a source bitmap. Rows of similar,
// neighbouring marks are text lines; each line's median mark height is its
// letter size, and the smallest line governs. No pixels change. A measurement
// that finds no confident text returns null, so callers keep their larger size.
import {execFileSync,execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Median mark height of a line is x-height for mixed case, cap height for
// capitals. 3.6pt is the x-height of 7pt sans type, the usual floor for
// printed tables and footnotes.
export const MIN_LETTER_POINTS=3.6;
const MAX_PIXELS=24e6,cache=new Map();

export function letteringFromGray(gray,w,h){
  if(!(w>0&&h>0)||gray.length!==w*h)return null;
  const hist=new Uint32Array(256);for(const v of gray)hist[v]++;
  let bg=0;for(let v=1;v<256;v++)if(hist[v]>hist[bg])bg=v;
  const fg=new Uint8Array(w*h);for(let i=0;i<fg.length;i++)fg[i]=Math.abs(gray[i]-bg)>80?1:0;
  const seen=new Uint8Array(w*h),stack=new Int32Array(w*h),marks=[];
  for(let start=0;start<fg.length;start++){
    if(!fg[start]||seen[start])continue;
    let top=0,x0=w,x1=-1,y0=h,y1=-1,area=0;stack[top++]=start;seen[start]=1;
    while(top){
      const p=stack[--top],x=p%w,y=(p-x)/w;area++;
      if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
        const q=ny*w+nx;if(fg[q]&&!seen[q]){seen[q]=1;stack[top++]=q;}
      }
    }
    const mw=x1-x0+1,mh=y1-y0+1;
    // Glyph-like marks: not specks, rules, borders or large artwork.
    if(mh>=5&&mh<=h/6&&mw<=mh*4&&mw>=1&&area>=mh)marks.push({x0,x1,y0,y1,h:mh});
  }
  if(marks.length>20000)return null;
  marks.sort((a,b)=>a.x0-b.x0);
  const parent=marks.map((_,i)=>i),find=i=>{while(parent[i]!==i)i=parent[i]=parent[parent[i]];return i;};
  for(let i=0;i<marks.length;i++){
    const a=marks[i];
    for(let j=i+1;j<marks.length;j++){
      const b=marks[j],big=Math.max(a.h,b.h);
      if(b.x0-a.x1>big*1.2)break;
      const overlap=Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0)+1;
      if(overlap>=Math.min(a.h,b.h)*.5&&big<=Math.min(a.h,b.h)*2.5)parent[find(j)]=find(i);
    }
  }
  const groups=new Map();marks.forEach((m,i)=>{const r=find(i);groups.get(r)?.push(m)??groups.set(r,[m]);});
  const lines=[...groups.values()].filter(g=>g.length>=4).map(g=>{
    const hs=g.map(m=>m.h).sort((a,b)=>a-b);return {marks:g.length,letter_px:hs[Math.floor(hs.length/2)]};
  });
  if(lines.length<2)return null;
  const sizes=lines.map(l=>l.letter_px).sort((a,b)=>a-b);
  return {lines:lines.length,min_letter_px:sizes[0],median_letter_px:sizes[Math.floor(sizes.length/2)]};
}

const DECODE=`import sys
from PIL import Image
im=Image.open(sys.argv[1]);im.load()
if im.width*im.height>${MAX_PIXELS}:sys.exit(3)
g=im.convert('RGBA');bg=Image.new('RGBA',g.size,(255,255,255,255));bg.alpha_composite(g)
g=bg.convert('L');sys.stdout.buffer.write(g.width.to_bytes(4,'big')+g.height.to_bytes(4,'big')+g.tobytes())`;
const fromDecoded=out=>{try{return letteringFromGray(out.subarray(8),out.readUInt32BE(0),out.readUInt32BE(4));}catch{return null;}};
const keyOf=path=>createHash('sha256').update(readFileSync(path)).digest('hex');

export function figureLettering(path){
  const key=keyOf(path);
  if(cache.has(key)&&!(cache.get(key) instanceof Promise))return cache.get(key);
  let result=null;
  try{result=fromDecoded(execFileSync('python3',['-c',DECODE,path],{maxBuffer:MAX_PIXELS+64,stdio:['ignore','pipe','ignore']}));}catch{result=null;}
  cache.set(key,result);return result;
}

// The same measurement without blocking, so preparation can overlap it with
// source inspection. Results are keyed by image bytes, never by path.
export function measureFigureLettering(path){
  const key=keyOf(path);
  if(cache.has(key))return Promise.resolve(cache.get(key));
  const work=new Promise(done=>execFile('python3',['-c',DECODE,path],{encoding:'buffer',maxBuffer:MAX_PIXELS+64},(error,out)=>done(error?null:fromDecoded(out))))
    .then(result=>{cache.set(key,result);return result;});
  cache.set(key,work);return work;
}

// Printed letter size of the smallest measured line at each reading setting.
export function letterPoints(lettering,size,sourceWidth){
  if(!lettering||!(sourceWidth>0)||!(size?.image_width_points>0))return null;
  return Math.round(lettering.min_letter_px*size.image_width_points/sourceWidth*100)/100;
}

// Fine text takes the smallest bounded setting whose measured letters meet
// the floor; without a confident measurement it keeps the largest setting.
export function legibleReadingSize(sizes,lettering,sourceWidth,min=MIN_LETTER_POINTS){
  const ordered=[...sizes].sort((a,b)=>a.image_width_points-b.image_width_points);
  const largest=ordered.at(-1)??null;
  if(!lettering)return largest;
  return ordered.find(s=>letterPoints(lettering,s,sourceWidth)>=min)??largest;
}
