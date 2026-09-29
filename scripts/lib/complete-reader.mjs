// Compact navigation metadata from the accepted book's measured physical pages.
// The PDF is read only: adding a browser reader must not change accepted bytes.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {validReaderMap} from '../../functions/lib/edition-reader.js';
export function completeReaderMap(book,total){
  const measurement=JSON.parse(readFileSync(book.pdf.replace(/\.pdf$/,'.pages.json'),'utf8'));
  const texts=execFileSync('pdftotext',['-layout',book.pdf,'-'],{encoding:'utf8',maxBuffer:20_000_000}).split('\f');
  if(measurement.pages?.length!==total)throw Error('Completed reader measurements do not match the PDF.');
  const folios=[],labels=[],prose=[];
  for(const f of [...(measurement.folios||[])].sort((a,b)=>a.page-b.page)){
    if(!Number.isSafeInteger(f.folio)){labels.push([f.page,`Page ${f.folio}`]);continue;}
    const last=folios.at(-1);
    if(last&&f.page===last[1]+1&&f.folio===last[2]+f.page-last[0])last[1]=f.page;
    else folios.push([f.page,f.page,f.folio]);
  }
  for(let page=1;page<=total;page++)if(!measurement.folios?.some(f=>f.page===page)&&/^\s*(?:table of )?contents\s*$/im.test(texts[page-1]||''))labels.push([page,'Contents']);
  for(const article of measurement.articles||[]){
    const source=book.report.postOrder?.[article.n-1],decision=source?book.report.publisher?.decisions?.find(d=>String(d.post_id)===String(source.id)):null;
    if(['essay','story','review','interview','dispatch'].includes(decision?.kind)){
      const last=prose.at(-1);if(last&&article.start<=last[1]+1)last[1]=Math.max(last[1],article.end);else prose.push([article.start,article.end]);
    }
  }
  const map={folios,labels,prose};if(!validReaderMap(map,total))throw Error('Completed reader page labels are invalid.');return map;
}
