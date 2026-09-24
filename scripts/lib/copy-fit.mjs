// Estimate one bounded leading adjustment from the actual stranded tail and
// available line gaps. The next PDF must still be measured and reviewed.
export function leadingForTail(measurement,article,current=.66){
  const end=measurement.pages?.[article.end-1]?.layout_geometry,previous=measurement.pages?.[article.end-2]?.layout_geometry;
  const lines=(measurement.pages||[]).slice(article.start-1,article.end).reduce((n,p)=>n+(p.layout_geometry?.blocks||[]).filter(b=>b.kind==='text'&&b.text?.trim()).length,0);
  const top=end?.body_bounds_points?.[1],bottom=end?.last_occupied_y_points,free=previous?.trailing_space_points;
  let step=.04;
  if([top,bottom,free].every(Number.isFinite)&&lines>1){
    const need=Math.max(0,bottom-top-free)+14;
    step=Math.max(.04,.04*Math.ceil((need/((lines-1)*10.5)+.01)/.04));
  }
  return Math.max(.54,+(current-Math.min(.12,step)).toFixed(2));
}

// A few remaining prose lines before an indivisible reading figure can strand
// an almost empty body leaf. Fit those lines back using the existing leading
// bounds; do not shrink the image or move it ahead of its source paragraph.
export function preFigureTextTails(measurement,fitText={}){
  const found=[];
  for(const page of measurement.pages||[]){
    const blocks=page.layout_geometry?.blocks;
    if(!Array.isArray(blocks)||!blocks.length||blocks.some(b=>b.kind!=='text'||!b.text?.trim())||blocks.length>3)continue;
    const article=(measurement.articles||[]).find(a=>a.start<page.page&&a.end>page.page);
    if(!article||(fitText[article.n]||.66)<=.54||(measurement.figures||[]).some(f=>f.page===page.page))continue;
    const figure=(measurement.figures||[]).find(f=>f.page===page.page+1&&f.article===article.n&&f.floating===false&&['column','landscape'].includes(f.reading_mode));
    if(!figure||!Number.isFinite(figure.h)||figure.h<=0)continue;
    const paragraph=(measurement.paragraphs||[]).find(p=>p.id===figure.source_next_paragraph-1&&p.start?.article===article.n&&p.start?.source_kind==='paragraph'&&p.start.page<page.page&&p.end?.page>=page.page&&p.end.page<=figure.page);
    if(!paragraph)continue;
    const geometry=page.layout_geometry,body=geometry.body_bounds_points;
    if(body?.length!==4||!body.every(Number.isFinite)||body[3]<=body[1]||!Number.isFinite(geometry.last_occupied_y_points)||geometry.last_occupied_y_points<body[1]||geometry.last_occupied_y_points-body[1]>(body[3]-body[1])*.15)continue;
    found.push({article:article.n,page:page.page,figure_id:figure.id,
      leading:leadingForTail(measurement,{...article,end:page.page},fitText[article.n]||.66)});
  }
  return found;
}
