// Reflow only recognized prose. Poetry, recipes, and unclassified work keep their
// PDF line breaks. PDF glyph text is retained; no summarization or model rewriting.
export function pdfPageText(items,{reflow=false}={}){
 const lines=[];let line=null;
 for(const item of items){
  if(typeof item.str!=='string')continue;
  if(!line)line={text:'',y:item.transform?.[5]||0,height:item.height||10};
  line.text+=item.str;line.height=Math.max(line.height,item.height||0);
  if(item.hasEOL){lines.push(line);line=null;}else if(item.str&&!/\s$/.test(item.str))line.text+=' ';
 }
 if(line)lines.push(line);
 const clean=lines.filter(l=>l.text.trim());if(!clean.length)return [];
 if(!reflow)return [{text:clean.map(l=>l.text.trim()).join('\n'),lines:true}];
 const gaps=clean.slice(1).map((l,i)=>clean[i].y-l.y).filter(g=>g>0).sort((a,b)=>a-b);
 const normal=gaps[Math.floor((gaps.length-1)/2)]||12,paragraphs=[];
 for(let i=0;i<clean.length;i++){
  const next=clean[i],previous=clean[i-1];
  const separate=!previous||previous.y-next.y>normal*1.3||Math.max(previous.height,next.height)/Math.max(1,Math.min(previous.height,next.height))>1.2;
  if(separate)paragraphs.push({text:next.text.trim(),lines:false});
  else {const p=paragraphs.at(-1);p.text+=/[-\u00ad]$/.test(p.text)?next.text.trim():' '+next.text.trim();}
 }
 return paragraphs;
}
