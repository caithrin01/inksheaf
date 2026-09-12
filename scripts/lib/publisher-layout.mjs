// Models select among measured, reversible typesetting operations. They never
// delete a source post, shrink type, invent figure dimensions or edit the prose.
import {z} from 'zod';
import {paragraphBoundaryContext} from './paragraph-boundaries.mjs';
export const LayoutDecisions=z.object({decisions:z.array(z.object({
  page:z.number().int().min(1),decision:z.enum(['repair','intentional_space','needs_review']),
  candidate_id:z.string().nullable(),reason:z.string().min(1).max(200),
}))});
// A floating image between a source paragraph's actual start/end interrupts its
// reading even when vision misses it. Positions come from the compiled document.
export function readingOrderFindings(measurement){
  const before=(a,b)=>a.page<b.page||(a.page===b.page&&a.y<b.y);
  const valid=p=>p&&Number.isInteger(p.page)&&Number.isFinite(p.y);
  const findings=[];
  for(const figure of measurement.figures||[]){
    if(!figure.floating||!valid(figure))continue;
    // A float can pass several complete sections without bisecting a paragraph.
    // Compare its original following paragraph with actual printed lines, not an
    // empty start marker carried across a page turn. Never cross article bounds.
    const next=(measurement.paragraphs||[]).find(p=>p.id===figure.source_next_paragraph&&figure.article>0&&p.start?.article===figure.article&&p.end?.article===figure.article&&valid(p.start)&&valid(p.end));
    if(next){
      const line=(measurement.pages||[]).flatMap(p=>(p.layout_geometry?.blocks||[])
        .filter(b=>b.kind==='text'&&b.text?.trim()&&b.bbox?.length===4&&b.bbox.every(Number.isFinite))
        .map(b=>({page:p.page,y:(b.bbox[1]+b.bbox[3])/2})))
        .filter(p=>!before(p,next.start)&&!before(next.end,p)).sort((a,b)=>a.page-b.page||a.y-b.y)[0];
      if(line&&before(line,figure)){
        findings.push({page:figure.page,check:8,figure_id:figure.id,paragraph_id:next.id,defect:'delayed_source_figure',confidence:1,origin:'measured_layout',note:`Floating figure ${figure.id} prints after text that followed it in the source. Keep it before source paragraph ${next.id}.`});
        continue;
      }
    }
    const paragraph=(measurement.paragraphs||[]).find(p=>valid(p.start)&&valid(p.end)&&before(p.start,figure)&&before(figure,p.end));
    if(paragraph)findings.push({page:figure.page,check:8,figure_id:figure.id,paragraph_id:paragraph.id,confidence:1,origin:'measured_layout',note:`Floating figure ${figure.id} interrupts source paragraph ${paragraph.id} between its measured start and end.`});
  }
  return findings;
}
export function pageContext(measurement,report) {
  const articles=measurement.articles||[],parts=new Map((measurement.parts||[]).map(p=>[p.page,p.title]));
  const first=Math.min(...articles.map(a=>a.start)),last=Math.max(...articles.map(a=>a.end));
  return (measurement.pages||[]).map(p=>{
    const article=articles.find(a=>p.page>=a.start&&p.page<=a.end);
    const title=article?report.publisher?.decisions.find(d=>String(d.post_id)===String(report.postOrder?.[article.n-1]?.id))?.title||report.postOrder?.[article.n-1]?.title:null;
    const folio=measurement.folios?.find(f=>f.page===p.page)?.folio??null;
    const headMap=measurement.engine==='typst'&&Array.isArray(measurement.folios);
    return {page:p.page,position:p.page===measurement.pages.length&&p.blank===1&&report.printInterior?'blank binding verso to complete an even leaf count':parts.has(p.page)?'section divider: '+parts.get(p.page):parts.has(p.page-1)&&!article&&p.blank===1?'blank verso after a section divider':parts.has(p.page+1)&&!article&&p.blank===1?'blank verso before a section divider':p.page<first?(p.blank===1?'blank front-matter verso':'front matter'):p.page>last?'end matter':article&&article.start===article.end?'complete short piece':article?.start===p.page?'article opening':article?.end===p.page?'article ending':'body',
      expected_printed_folio:folio,
      folio_map_available:Array.isArray(measurement.folios),
      // Matches this renderer's alternating publication/essay heads, suppressed
      // on openers and structural leaves. Capitalisation is a styling choice.
      running_head_map_available:headMap,
      expected_running_head:headMap&&article&&article.start!==p.page&&folio!==null?(folio%2?title:report.pubName||null):null,
      article_title:title,publication:report.pubName||null,
      paragraph_boundaries:paragraphBoundaryContext(measurement,p.page),
      ...((measurement.figures||[]).some(f=>f.page===p.page&&f.reading_mode==='landscape')?{figure_orientation:'A quarter-turn figure is intentional landscape reading. Check its actual readability, caption and bounds; rotation alone is not a defect.'}:{}),
      ...((measurement.publisher_marks||[]).some(m=>m.page===p.page)?{publisher_mark:'Intentional pale Inksheaf watermark on publisher opening or closing matter.'}:{})};
  });
}
export function layoutBatches(input,size=12){
  if(!Number.isInteger(size)||size<1||size>12)throw Error('Invalid layout batch size');
  const batches=[];
  for(let i=0;i<input.pages.length;i+=size){const pages=input.pages.slice(i,i+size),ids=new Set(pages.map(p=>p.page));batches.push({...input,pages,candidates:input.candidates.filter(c=>ids.has(c.page))});}
  return batches;
}
// Keep adjacent-page evidence with its concern even when review batches split at
// that page. Local image paths and unrelated source text never enter this packet.
export function adjacentLayoutContext(measurement,page,pageText=[]){
  const pages=measurement.pages||[],articles=measurement.articles||[];
  const owner=n=>articles.find(a=>n>=a.start&&n<=a.end)?.n;
  const excerpt=(value,limit,tail=false)=>{
    const text=String(value||'');return {text:tail?text.slice(-limit):text.slice(0,limit),truncated:text.length>limit};
  };
  const view=(n,edge)=>{
    const p=pages.find(p=>p.page===n);if(!p)return null;
    const geometry=p.layout_geometry,all=geometry?.blocks||[];
    const blocks=edge==='end'?all.slice(-6):all.slice(0,8);
    const figures=(measurement.figures||[]).filter(f=>f.page===n);
    const paragraphs=(measurement.paragraphs||[]).filter(p=>p.start?.page<=n&&p.end?.page>=n);
    const anchors=edge==='end'?paragraphs.slice(-4):paragraphs.slice(0,4);
    return {page:n,same_article:owner(page)!=null&&owner(n)===owner(page),
      printed_excerpt:excerpt(pageText[n-1],2000,edge==='end'),
      body_bounds_points:geometry?.body_bounds_points??null,
      last_occupied_y_points:geometry?.last_occupied_y_points??null,
      trailing_space_points:geometry?.trailing_space_points??null,
      printed_blocks:blocks.map(({kind,bbox,text})=>({kind,bbox,...(text!=null?{printed_text:excerpt(text,400)}:{})})),
      printed_blocks_truncated:blocks.length<all.length,
      figures:figures.slice(0,12).map(({id,role,page,y,h,w,floating,reading_mode})=>({id,role,page,y_points:y,height_points:h,width_points:w,floating,reading_mode})),
      figures_truncated:figures.length>12,
      paragraph_anchors:anchors.map(({id,start,end})=>({id,start:start?{page:start.page,y:start.y}:start,end:end?{page:end.page,y:end.y}:end})),
      paragraph_anchors_truncated:anchors.length<paragraphs.length};
  };
  return {previous_page:view(page-1,'end'),current_page:view(page,'end'),next_page:view(page+1,'start')};
}
export function layoutInput({measurement,report,fit,review,pdfHash,pageText=[]}) {
  const pages=measurement.pages||[],articles=measurement.articles||[],candidates=[];
  const context=new Map(pageContext(measurement,report).map(p=>[p.page,p]));
  // `blank` measures the trailing gap only. Top-aligned empty areas (e.g. a
  // copyright leaf) and large internal gaps also need a recorded design reason.
  const unused=p=>Math.min(1,Math.max(Number.isFinite(p.unused)?p.unused:0,(p.blank||0)+Math.max(0,p.ink_top||0),p.hole||0));
  const concerns=new Set(pages.filter(p=>unused(p)>.30).map(p=>p.page));
  for(const f of review.findings||[])concerns.add(f.page);
  for(const f of measurement.figures||[]){
    if(!(review.findings||[]).some(v=>v.page===f.page&&v.check===3))continue;
    for(const size of f.reading_sizes||[]){
      if(!['column','landscape'].includes(size.mode)||size.mode===fit.readingFigures?.[f.id]||![size.image_width_points,size.width_points,size.height_points].every(v=>Number.isFinite(v)&&v>0)||!Number.isFinite(f.image_width_points)||size.image_width_points<=f.image_width_points*1.12)continue;
      candidates.push({id:`reading:${f.id}:${size.mode}`,page:f.page,operation:'set_figure_reading_size',figure:f.id,...size});
    }
  }
  for(const page of concerns){
    const findings=(review.findings||[]).filter(f=>f.page===page);
    if(!findings.some(f=>[2,8].includes(f.check)))continue;
    const measuredIds=new Set(findings.filter(f=>f.figure_id).map(f=>f.figure_id));
    // A measured floating image on this or the next page may split a paragraph.
    // Keeping it at its source position changes no prose, size or image bytes.
    for(const figure of measurement.figures||[]){
      if(figure.floating!==true||![page,page+1].includes(figure.page)||(fit.inFlow||[]).includes(figure.id))continue;
      if(measuredIds.size&&!measuredIds.has(figure.id))continue;
      candidates.push({id:`inflow:${figure.id}:${page}`,page,operation:'keep_figure_in_flow',figure:figure.id,figure_page:figure.page});
    }
  }
  for(const f of measurement.fit||[]){
    if(!fit.readingFigures?.[f.id]&&Number.isFinite(f.height)&&f.height>=1.2&&f.height<=5.5&&(!fit.fitFigs?.[f.id]||f.height<fit.fitFigs[f.id]-.09))candidates.push({id:`figure:${f.id}`,page:f.page,operation:'fit_figure',figure:f.id,height:f.height});
  }
  for(const a of articles){
    const page=pages[a.end-1],current=fit.fitText?.[a.n]||.66;
    if(a.end>a.start&&page?.blank>.30&&current>.54)candidates.push({id:`leading:${a.n}`,page:a.end,operation:'tighten_leading',article:a.n,leading:Math.max(.54,+(current-.04).toFixed(2))});
    if(a.end>a.start&&page?.blank>.30&&!fit.backLinks?.includes(a.n)&&measurement.linkStarts?.some(l=>l.n===a.n&&l.page>=a.end-1))candidates.push({id:`references:${a.n}`,page:a.end,operation:'collect_references',article:a.n});
  }
  return {pdf_hash:pdfHash,candidates,pages:pages.filter(p=>concerns.has(p.page)).map(p=>{
    const a=articles.find(a=>p.page>=a.start&&p.page<=a.end),post=a?report.postOrder?.[a.n-1]:null;
    const reading=report.publisher?.decisions.find(d=>String(d.post_id)===String(post?.id));
    return {page:p.page,printed_text:String(pageText[p.page-1]||'').slice(0,12000),printed_text_truncated:String(pageText[p.page-1]||'').length>12000,unused_body_fraction_lower_bound:unused(p),measured_unused_body_fraction:p.unused??null,whitespace_metric:measurement.whitespace_metric??null,trailing_unused_fraction:p.blank,ink_rows:p.ink_rows,
      ...context.get(p.page),
      adjacent_layout:adjacentLayoutContext(measurement,p.page,pageText),
      title:reading?.title,kind:reading?.kind,editorial_reason:reading?.reason,
      internal_gap_fraction:p.hole,first_ink_position:p.ink_top,
      figures:(measurement.figures||[]).filter(f=>f.page===p.page).map(({id,role,h,w,floating,reading_mode})=>({id,role,height_points:h,width_points:w,floating,reading_mode})),
      design_purpose:a&&a.start===a.end?'This independent piece starts and finishes on the same page. The book design starts each piece on a new page. Remaining space after its complete text separates it from the next piece.':null,
      findings:(review.findings||[]).filter(f=>f.page===p.page)};
  })};
}
export function validateLayout(result,input){
  const invalid=message=>Object.assign(Error(message),{code:'PUBLISHER_LAYOUT_INVALID'});
  const parsed=LayoutDecisions.parse(result),seen=new Set(),pages=new Map(input.pages.map(p=>[p.page,p])),candidates=new Map(input.candidates.map(c=>[c.id,c]));
  for(const d of parsed.decisions){
    const p=pages.get(d.page);if(!p||seen.has(d.page))throw invalid('Layout review must account for each supplied page exactly once');seen.add(d.page);
    if(d.decision==='repair'&&candidates.get(d.candidate_id)?.page!==d.page)throw invalid('Layout repair is not a measured operation for this page');
    if(d.decision!=='repair'&&d.candidate_id!==null)throw invalid('Layout verdict has an unused repair operation');
    if(d.decision==='intentional_space'&&p.findings.some(f=>f.check!==1))throw invalid(`Page ${p.page}: a content or overflow defect (checks ${p.findings.filter(f=>f.check!==1).map(f=>f.check).join(', ')}) cannot be excused as intentional space. Choose an applicable measured repair or needs_review`);
    if(d.decision==='intentional_space'&&p.position==='article ending'&&Number.isFinite(p.ink_rows)&&p.ink_rows<.25
      &&!(p.figures||[]).length&&!['poem','recipe'].includes(p.kind))throw invalid(`Page ${p.page}: a sparse prose tail occupies less than a quarter of the page. Article-end separation cannot excuse it; choose an applicable repair or needs_review.`);
  }
  if(seen.size!==pages.size)throw invalid('Layout review omitted a measured page');
  return parsed;
}
export function applyLayoutRepairs(fit,result,input){
  validateLayout(result,input);
  const next={defer:[...(fit.defer||[])],fitFigs:{...fit.fitFigs},fitText:{...fit.fitText},backLinks:[...(fit.backLinks||[])],inFlow:[...(fit.inFlow||[])]};
  if(fit.readingFigures)next.readingFigures={...fit.readingFigures};
  for(const d of result.decisions.filter(d=>d.decision==='repair')){
    const c=input.candidates.find(c=>c.id===d.candidate_id);
    if(c.operation==='fit_figure')next.fitFigs[c.figure]=c.height;
    else if(c.operation==='tighten_leading')next.fitText[c.article]=c.leading;
    else if(c.operation==='collect_references')next.backLinks.push(c.article);
    else if(c.operation==='keep_figure_in_flow'&&!next.inFlow.includes(c.figure))next.inFlow.push(c.figure);
    else if(c.operation==='set_figure_reading_size'){
      next.readingFigures??={};next.readingFigures[c.figure]=c.mode;
      delete next.fitFigs[c.figure];
    }
  }
  return next;
}
