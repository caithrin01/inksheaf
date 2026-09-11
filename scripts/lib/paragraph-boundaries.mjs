// Ground check 2 in compiled paragraph anchors and actual printed line boxes.
// A page turn in a sentence is not, by itself, a one-line widow or orphan.
const point = p => p && Number.isInteger(p.page) && Number.isFinite(p.y);
const before = (a,b) => a.page < b.page || (a.page === b.page && a.y <= b.y);
const middle = b => (b.bbox[1]+b.bbox[3])/2;
const validLine = b => b.kind === 'text' && typeof b.text === 'string' && b.text.trim()
  && Array.isArray(b.bbox) && b.bbox.length === 4 && b.bbox.every(Number.isFinite);

export function paragraphBoundaryContext(measurement, page) {
  const paragraphs=(measurement.paragraphs||[]).filter(p=>point(p.start)&&point(p.end)&&before(p.start,p.end));
  const rows=n=>measurement.pages?.find(p=>p.page===n)?.layout_geometry?.blocks;
  const contains=(p,n,b)=>before(p.start,{page:n,y:middle(b)})&&before({page:n,y:middle(b)},p.end);
  const segment=(p,n)=>{
    const blocks=rows(n);if(!Array.isArray(blocks))return null;
    const lines=blocks.filter(validLine).filter(b=>contains(p,n,b)).sort((a,b)=>middle(a)-middle(b)||a.bbox[0]-b.bbox[0]);
    // PDF extractors may split one printed line into several inline spans.
    const grouped=[];
    for(const b of lines){const last=grouped.at(-1);if(last&&Math.abs(last.y-middle(b))<1)last.text+=' '+b.text.trim();else grouped.push({y:middle(b),text:b.text.trim()});}
    return {page:n,line_count:grouped.length,first_line:grouped[0]?.text.slice(0,400)||null,last_line:grouped.at(-1)?.text.slice(0,400)||null};
  };
  const edge=side=>{
    const blocks=rows(page);if(!Array.isArray(blocks))return {status:'unknown',reason:'Printed line geometry is unavailable.'};
    const ordered=[...blocks].sort((a,b)=>(a.bbox?.[1]??0)-(b.bbox?.[1]??0));
    const line=side==='top'?ordered[0]:ordered.at(-1);
    if(!line||!validLine(line))return {status:'unknown',reason:'The edge is not a measured prose line.'};
    const owners=paragraphs.filter(p=>contains(p,page,line));
    if(owners.length!==1)return {status:'unknown',reason:'The edge line has no unique paragraph anchor; a heading or caption still needs visual review.',printed_line:line.text.slice(0,400)};
    const p=owners[0],current=segment(p,page),previous=p.start.page<page?segment(p,page-1):null,next=p.end.page>page?segment(p,page+1):null;
    const ambiguous=blocks.filter(validLine).filter(b=>contains(p,page,b)).some(b=>paragraphs.filter(q=>contains(q,page,b)).length!==1);
    return {status:ambiguous?'unknown':current.line_count>=2?'multiple_lines':p.start.page===p.end.page?'complete_single_line_paragraph':'single_line_fragment',
      paragraph_id:p.id,anchors:{start:p.start,end:p.end},current,previous,next};
  };
  const top=edge('top'),foot=edge('foot');
  // A complete paragraph can also act as a heading. Clear automatically only
  // when both edges are proven multi-line continuations across their page turns.
  return {top,foot,verified_no_single_line_fragment:top.status==='multiple_lines'&&top.previous?.line_count>=2
    &&foot.status==='multiple_lines'&&foot.next?.line_count>=2};
}
