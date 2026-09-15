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
