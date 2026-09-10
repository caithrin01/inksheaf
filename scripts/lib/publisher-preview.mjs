// Extract a small, private reading window from real typeset bytes. No model call,
// source rewriting or finished-proof claim. The complete PDF still needs review.
import {PDFDocument} from 'pdf-lib';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const PREVIEW_MAX_BYTES=10_000_000;
export function previewPages(measurement,texts,total){
  const picked=new Set(),add=n=>{if(Number.isInteger(n)&&n>=1&&n<=total&&picked.size<6)picked.add(n);};
  const opening=measurement.articles?.[0]?.start;
  for(const mark of measurement.publisher_marks||[])add(mark.page);
  // Prefer the contents and a sustained opening. Keep the original page labels.
  texts.slice(0,Math.min(opening||8,12)).forEach((s,i)=>{if(/^\s*(?:table of )?contents\s*$/im.test(s))add(i+1);});
  if(opening){add(opening);add(opening+1);}
  for(const figure of measurement.figures||[]){if(picked.size>=6)break;add(figure.page);}
  if(!picked.size)for(const p of measurement.pages||[]){if((texts[p.page-1]||'').trim())add(p.page);}
  if(!picked.size)add(1);
  return [...picked].sort((a,b)=>a-b).map(number=>{
    const folio=measurement.folios?.find(f=>f.page===number)?.folio;
    const label=folio!=null?`Page ${folio}`:/^\s*(?:table of )?contents\s*$/im.test(texts[number-1]||'')?'Contents':`Leaf ${number}`;
    return {number,label};
  });
}
export async function extractPublisherPreview(book,{output=book.pdf.replace(/\.pdf$/,'.preview.pdf')}={}){
  const source=readFileSync(book.pdf),measurement=JSON.parse(readFileSync(book.pdf.replace(/\.pdf$/,'.pages.json'),'utf8'));
  const doc=await PDFDocument.load(source),texts=execFileSync('pdftotext',['-layout',book.pdf,'-'],{encoding:'utf8',maxBuffer:20_000_000}).split('\f');
  const prose=new Set(['essay','story','review','interview','dispatch']);
  const pages=previewPages(measurement,texts,doc.getPageCount()).map(page=>{
    const article=measurement.articles?.find(a=>a.start<=page.number&&a.end>=page.number);
    const source=article?book.report.postOrder?.[article.n-1]:null;
    const decision=source?book.report.publisher?.decisions?.find(d=>String(d.post_id)===String(source.id)):null;
    return {...page,text_mode:prose.has(decision?.kind)?'prose':'lines'};
  });
  const preview=await PDFDocument.create();
  for(const page of await preview.copyPages(doc,pages.map(p=>p.number-1)))preview.addPage(page);
  preview.setTitle(`${book.report.pubName||'Your edition'} — pages in progress`);
  preview.setSubject('Private draft excerpt. Layout checks are still in progress.');
  // Stable metadata keeps unchanged snapshots reusable during a retry.
  preview.setCreationDate(new Date(0));preview.setModificationDate(new Date(0));
  const bytes=await preview.save();
  if(bytes.length>PREVIEW_MAX_BYTES)throw Error('The reading preview exceeds its size limit.');
  writeFileSync(output,bytes);
  return {file:output,pages,total_pages:doc.getPageCount(),sha256:createHash('sha256').update(bytes).digest('hex'),source_sha256:createHash('sha256').update(source).digest('hex')};
}
export async function publishPreview({book,volume,round,upload,url,key,emit,log=()=>{},extract=extractPublisherPreview}){
  let preview;
  try{preview=await extract(book);const name=key(preview.file);await upload(preview.file,name);preview.url=url(name);}
  catch{log('The page preview is temporarily unavailable; complete book checks continue.');return false;}
  // A selection or persistence failure must reach the orchestrator. Never swallow
  // a stale selection here, or write private file paths/URLs to public job logs.
  await emit({kind:'pages',volume,round,draft:true,pages:preview.pages,total_pages:preview.total_pages,sha256:preview.sha256,source_sha256:preview.source_sha256,file_url:preview.url});
  return true;
}
