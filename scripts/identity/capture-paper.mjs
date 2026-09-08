import{chromium}from'playwright';
import{mkdir,copyFile}from'node:fs/promises';
const out='output/style-guide-paper';await mkdir(out,{recursive:true});
const b=await chromium.launch();try{for(const width of [1440,390]){const p=await b.newPage({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce'});await p.goto('http://127.0.0.1:8830/');await p.evaluate(()=>document.fonts.ready);for(const id of ['type','object','covers','interior']){await p.locator('#'+id).screenshot({path:`${out}/${id}-${width}.png`});if(width===1440)await copyFile(`${out}/${id}-${width}.png`,`output/style-guide/${id}-${width}.png`);}await p.locator('.paper-stock').screenshot({path:`${out}/leaf-${width}.png`});await p.close();}}finally{await b.close()}
