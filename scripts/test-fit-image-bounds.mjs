// Embedding the original pixels does not prove they are visible: an oversized
// height-only panorama can be clipped by its figure. Inspect the actual raster.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {emitTypst} from './lib/typst-emit.mjs';
mkdirSync('proofs',{recursive:true});const dir=mkdtempSync(resolve('proofs/fit-image-bounds-'));
try{
 execFileSync('python3',['-c',`from PIL import Image,ImageDraw
import sys
im=Image.new('RGB',(1800,600),'white');draw=ImageDraw.Draw(im)
draw.rectangle((0,0,149,599),fill=(230,20,20));draw.rectangle((1650,0,1799,599),fill=(20,20,230))
im.save(sys.argv[1])`,join(dir,'wide.png')]);
 const html='<html><body><section class="article"><header class="arthead"><h2 class="arttitle">Panorama</h2></header><div class="artbody"><p>BeforeStripMarker.</p><figure><img data-fig="strip" src="wide.png" alt="panoramic photo"/></figure><p>AfterStripMarker.</p></div></section></body></html>';
 for(const [height,nested] of [[4.17,false],[1,false],[4.17,true]]){
  const typ=join(dir,`${height}-${nested}.typ`),pdf=join(dir,`${height}-${nested}.pdf`);
  const source=nested?html.replace('<figure>','<blockquote><figure>').replace('</figure>','</figure></blockquote>'):html;
  writeFileSync(typ,emitTypst(source,{baseDir:dir,fitFigs:{strip:height},publisherWatermarks:false}));
  execFileSync('typst',['compile','--font-path','fonts',typ,pdf],{stdio:'pipe'});
  const result=JSON.parse(execFileSync('python3',['-c',`import fitz,json,sys
d=fitz.open(sys.argv[1]);rows=[]
for p in d:
 for im in p.get_image_info():
  pix=p.get_pixmap(matrix=fitz.Matrix(1,1),colorspace=fitz.csRGB,alpha=False);raw=pix.samples
  red=sum(1 for i in range(0,len(raw),3) if raw[i]>180 and raw[i+1]<70 and raw[i+2]<70)
  blue=sum(1 for i in range(0,len(raw),3) if raw[i+2]>180 and raw[i]<70 and raw[i+1]<70)
  rows.append({'box':im['bbox'],'red_pixels':red,'blue_pixels':blue})
print(json.dumps(rows))`,pdf],{encoding:'utf8'}));
  assert.equal(result.length,1);const r=result[0];
  assert(r.red_pixels>500&&r.blue_pixels>500,'Both outer source edges must be visible in the rendered PDF');
  assert(r.box[0]>=44&&r.box[2]<=389&&r.box[1]>=50&&r.box[3]<=597,'The actual image fits the usable page');
  assert(Math.abs((r.box[2]-r.box[0])/(r.box[3]-r.box[1])-3)<.001,'Original aspect ratio survives');
  assert(r.box[3]-r.box[1]<=height*72+.01,'A requested fit cannot become taller');
 }
 console.log('PASS wide photograph fits at two requested heights and inside a quotation; both source edges visible in actual rasters; aspect ratio intact');
}finally{rmSync(dir,{recursive:true,force:true});}
