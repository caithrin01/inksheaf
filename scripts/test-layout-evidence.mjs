import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {rasterise} from './lib/page-review.mjs';
import {prepareLayoutEvidence} from './lib/layout-evidence.mjs';
import {publisherSession} from './lib/publisher-session.mjs';
const directory=mkdtempSync(join(tmpdir(),'layout-evidence-'));
try{
  const pdf=join(directory,'book.pdf'),doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.TimesRoman);
  for(let i=1;i<=5;i++)doc.addPage([432,648]).drawText(`Complete piece ${i}`,{x:60,y:530,size:12,font});
  writeFileSync(pdf,await doc.save());
  const rasterDirectory=join(directory,'pages');rasterise(pdf,rasterDirectory);
  const input={pdf_hash:'fixture-pdf',pages:[1,2,4,5].map(page=>({page,position:'complete short piece',findings:[]})),candidates:[]};
  const options={directory,rasterDirectory,pageCount:5,policy:'test-policy'};
  const evidence=prepareLayoutEvidence(input,options);
  assert.deepEqual(evidence.input.pages.map(p=>p.visual_context.physical_pages),[[1,2],[1,2,3],[3,4,5],[4,5]]);
  assert(!JSON.stringify(evidence.input).includes(directory),'Local paths must not enter the model packet');
  const counts=[];const env={OPENROUTER_API_KEY:'fixture'},journal=join(directory,'publisher');
  const fetchImpl=async(url,options)=>{
    const body=JSON.parse(options.body),content=body.messages[1].content;
    const data=JSON.parse(content[0].text.split('\n\nSource data:\n')[1]);
    assert.equal(content.length,data.pages.length+1);assert(content.length<=4);
    assert.equal(body.max_tokens,Math.max(600,400*data.pages.length+100));
    for(let i=0;i<data.pages.length;i++)assert.equal(content[i+1].image_url.url,'data:image/png;base64,'+readFileSync(evidence.imagesByPage.get(data.pages[i].page)).toString('base64'));
    counts.push(data.pages.length);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({decisions:data.pages.map(p=>({page:p.page,decision:'intentional_space',space_basis:'single_piece',candidate_id:null,reason:'The complete one-page piece ends before the next independent work.'}))})}}],usage:{cost:.001}});
  };
  const session=()=>publisherSession({directory:journal,env,fetchImpl});
  const result=await(await session()).layout(evidence.input,{imagesByPage:evidence.imagesByPage});
  assert.deepEqual(counts,[3,1]);assert.equal(result.decisions.length,4);
  await(await session()).layout(evidence.input,{imagesByPage:evidence.imagesByPage});assert.deepEqual(counts,[3,1]);
  // An altered image cannot inherit approval merely because its pathname and PDF
  // identity match. Use another valid raster so the provider limits still apply.
  writeFileSync(evidence.imagesByPage.get(1),readFileSync(evidence.imagesByPage.get(5)));
  await(await session()).layout(evidence.input,{imagesByPage:evidence.imagesByPage});assert.deepEqual(counts,[3,1,3]);
  const missing=new Map(evidence.imagesByPage);missing.delete(1);
  await assert.rejects((await session()).layout(evidence.input,{imagesByPage:missing}),/missing a required/);
  assert.deepEqual(counts,[3,1,3]);
  unlinkSync(join(rasterDirectory,'p-3.png'));
  assert.throws(()=>prepareLayoutEvidence(input,options),/missing a required/);
  console.log('PASS actual neighbour images, three-sheet limits, complete coverage, private paths, byte-bound caching and missing-image holds');
}finally{rmSync(directory,{recursive:true,force:true});}
