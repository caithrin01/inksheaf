// Reading-size options come from the actual bitmap and the physical text block.
// Rotation changes page placement only; pixels, aspect ratio and captions survive.
export function figureReadingSizes(dim,{textWidth=4.53,textHeight=7.44,minPpi=150}={}){
  if(!dim||![dim.w,dim.h,textWidth,textHeight,minPpi].every(x=>Number.isFinite(x)&&x>0))return [];
  const aspect=dim.w/dim.h,heightLimit=textHeight-.7;
  if(heightLimit<=0)return [];
  const make=(mode,maxWidth,maxHeight)=>{
    const imageWidth=Math.floor(Math.min(maxWidth,maxHeight*aspect,dim.w/minPpi)*1000)/1000;
    const imageHeight=imageWidth/aspect;
    return {mode,image_width_points:imageWidth*72,image_height_points:imageHeight*72,
      width_points:(mode==='landscape'?imageHeight:imageWidth)*72,
      height_points:(mode==='landscape'?imageWidth:imageHeight)*72};
  };
  const column=make('column',textWidth,heightLimit),sizes=[column];
  if(aspect>=1.25){const landscape=make('landscape',heightLimit,textWidth);if(landscape.image_width_points>column.image_width_points*1.12)sizes.push(landscape);}
  return sizes.filter(s=>s.image_width_points>0);
}
