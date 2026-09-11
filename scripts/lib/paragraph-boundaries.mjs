// Ground check 2 in compiled paragraph anchors and actual printed line boxes.
// A page turn in a sentence is not, by itself, a one-line widow or orphan.
import {z} from 'zod';
export const BoundaryConfirmation=z.object({
  confirmed:z.boolean(),origin:z.enum(['rendered_layout','source_content','uncertain']),note:z.string().max(200),
  defect:z.enum(['single_line_fragment','stranded_heading','none','uncertain']),edge:z.enum(['top','foot','both','uncertain']),
}).refine(r=>!(r.confirmed&&r.defect==='none'),{message:'A confirmation cannot claim there is no defect.'});

// A typed single-line claim can be contradicted by actual lines. Keep the
// original model answer in the audit; missing evidence or a heading claim is
// never cleared by paragraph counts alone.
export function adjudicateBoundaryConfirmation(answer,context){
  const result=BoundaryConfirmation.parse(answer);
  if(result.defect==='uncertain')return {...result,confirmed:true,origin:'uncertain',model_confirmation:result};
  if(!result.confirmed||result.defect!=='single_line_fragment'||result.edge==='uncertain')return result;
  const edges=result.edge==='both'?['top','foot']:[result.edge];
  const evidence=edges.map(edge=>context?.[edge]);
  if(!evidence.every(e=>e&&['multiple_lines','complete_single_line_paragraph'].includes(e.status)))return result;
  return {...result,confirmed:false,origin:'measured_layout',model_confirmation:result,
    note:'Printed paragraph lines contradict this single-line-fragment claim. Complete source paragraphs and multi-line continuations are not split one-line fragments.'};
}
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
    const startsHere=p.start.page===page||(p.start.page===page-1&&previous?.line_count===0);
    const endsHere=p.end.page===page||(p.end.page===page+1&&next?.line_count===0);
    const complete=startsHere&&endsHere;
    const continuation=(previous?.line_count||0)>0||(next?.line_count||0)>0;
    return {status:ambiguous?'unknown':current.line_count>=2?'multiple_lines':complete?'complete_single_line_paragraph':continuation?'single_line_fragment':'unknown',
      paragraph_id:p.id,anchors:{start:p.start,end:p.end},printed_complete_on_page:!ambiguous&&complete,current,previous,next};
  };
  const top=edge('top'),foot=edge('foot');
  // A complete paragraph can also act as a heading. Clear automatically only
  // when both edges are proven multi-line continuations across their page turns.
  return {top,foot,verified_no_single_line_fragment:top.status==='multiple_lines'&&top.previous?.line_count>=2
    &&foot.status==='multiple_lines'&&foot.next?.line_count>=2};
}
